# Proposal

## Why

Today one loop does everything, in order: train, then scan, then wait (IDLE,
poll, or exit). Its failure policy is to exit the process after `MAX_RETRIES`
failures, so Docker restarts the container. That model breaks down when one
process serves several mailboxes:

- one mailbox with a bad password would take every other mailbox down with it;
- training and scanning can't run at their own pace;
- nothing can be triggered on demand.

This change gives each mailbox its own runner, with independent jobs, and
failures that stay contained to that mailbox.

Depends on `2-nest-server-foundation`, and replaces its minimal run loop.

## What Changes

- **One runner per mailbox, in process.** The server runs as a single
  instance. At startup, one `MailboxRunner` is started for each mailbox in the
  `MailboxRepository`, and each runner is stopped gracefully on shutdown.
  "Gracefully" means the in-flight job finishes and no new job starts.
- **Jobs are separate from triggers.** The jobs are `init-folders` (once, at
  runner start), `scan`, and the training jobs (`train-spam`, `train-ham`,
  `train-whitelist`, `train-blacklist`). The triggers are the global interval
  timer, IDLE notifications, and on-demand calls. Each job opens its own IMAP
  connection and always closes it.
- **Single-flight with coalescing.** A job never runs twice at once for the
  same mailbox. If a trigger fires while the job is running, the job runs once
  more afterwards. Triggers are never queued N times and never dropped.
- **IDLE first, falling back to the loop.** On a mailbox's first successful
  connection, the runner checks whether the server advertises the `IDLE`
  capability:
  - **Supported:** an inbox watcher holds a dedicated IDLE connection, and each
    `EXISTS` notification triggers a scan, draining until nothing new remains.
  - **Not supported:** the mailbox is scanned on the interval only, until the
    process restarts.

  The runner checks the capability itself, so the IMAP library can't quietly
  swap IDLE for NOOP polling. An IDLE connection that drops or errors is a
  normal failure, not a reason to fall back.
- **One global interval.** It applies to every mailbox and can't be changed
  per mailbox. It is the only trigger for training (IDLE only watches the
  inbox). It is also a safety net for scans when IDLE works, covering silent
  connection drops, so `IDLE_WATCHDOG_MS` goes away.
- **Degraded, not dead.** A failing job (connection refused, auth error,
  rspamd down) marks its mailbox `degraded`, records the last error, and
  retries with exponential backoff up to a cap. The process never exits
  because of one mailbox. A later success clears `degraded`, and an on-demand
  trigger retries immediately and resets the backoff. Training jobs keep their
  best-effort semantics (`batch-processing-resilience`).
- **No single-run mode.** A single run only happens when triggered on demand,
  through the API in `5-server-api-auth`.
- **Status.** Each runner exposes its status, which feeds the health and API
  endpoints: running or degraded, IDLE or loop, last run and result per job,
  last error, and when the next retry is due.
- **AI failures are shown in status only.** One global AI failure tracker
  (the AI provider is shared by all mailboxes) counts consecutive
  same-reason failures and exposes them in status. No alert email is sent,
  which retires the alert step and the alert-email service.

## Capabilities

### New Capabilities

- `server/mailbox-runtime`: the per-mailbox runner lifecycle, the jobs versus
  triggers split, single-flight with coalescing, IDLE-first with capability
  detection and fallback to the loop until restart, the global interval as
  training trigger and scan safety net, degraded state with capped backoff,
  graceful shutdown, and runner status.
- `server/ai-failure-status`: global consecutive-failure tracking by
  normalized reason, reported in status and never by email.

### Modified Capabilities

_None._ `orchestration` and `ai-failure-notification` keep describing
`terminal/` until it is retired.

## Impact

- **Connections:** each mailbox holds one long-lived IDLE connection, plus
  short-lived connections for each running job, typically 2 to 4 at once.
  That fits common per-user limits (Dovecot's default is 10, Gmail allows 15).
- **Config:** `SCAN_INTERVAL` stops encoding a mode and becomes a positive
  global interval. It may be renamed, since there's no compatibility to keep.
  A separate global training interval may be added (design).
- **Kept but unused:** the IDLE code in terminal stays as reference only.
