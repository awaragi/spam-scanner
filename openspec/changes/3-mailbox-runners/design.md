# Design

## Context

See `proposal.md` for motivation. `2-nest-server-foundation` built a minimal
stand-in for everything this change replaces: `runtime/mailbox-loop.service.ts`
(`MailboxLoopService`) opens one mailbox from `MailboxRepository`, runs
`FolderInitService` once at bootstrap, then on a fixed `setInterval` runs the
four training jobs and a scan-until-drained loop — each job on its own fresh
`MailboxSession` — logging and continuing past any failure, with no IDLE, no
backoff, no status, and shutdown that only stops future ticks.

Verified this session, directly against `imapflow`'s installed source
(`node_modules/imapflow/lib/imap-flow.js`, not just its `.d.ts`):
- `imap.capabilities` is a `Map<string, boolean | number>`, populated with
  plain uppercase IMAP capability tokens (confirmed via
  `this.capabilities.has('STARTTLS')`/`'ID'`/`'LOGINDISABLED')` elsewhere in
  the same file) — so `imap.capabilities.has('IDLE')`, checked once right
  after `connect()`, is the real-support check the proposal calls for.
- `missingIdleCommand?: 'NOOP' | 'SELECT' | 'STATUS'` (default `'NOOP'`) is
  the exact silent-fallback mechanism the proposal warns about: without an
  explicit capability check, a server lacking IDLE just gets polled via NOOP
  and nothing tells the caller.
- `disableAutoIdle?: boolean` turns off `imapflow`'s own automatic
  IDLE-when-inactive behavior. Since this change's inbox watcher decides for
  itself when to enter IDLE (via `infrastructure/imap/inbox.watcher.ts`'s
  already-ported `waitForNewMail`), every connection this runner opens uses
  `disableAutoIdle: true` so `imapflow` never enters IDLE on its own
  initiative and never invokes `missingIdleCommand`'s fallback behind the
  runner's back.

`infrastructure/imap/inbox.watcher.ts` (the ported `waitForNewMail`,
including its pre-IDLE catch-up and watchdog) already exists from
`2-nest-server-foundation`, unused. This change is what wires it in.

## Goals / Non-Goals

**Goals:**
- Replace `MailboxLoopService` with a per-mailbox runner implementing every
  behavior in the proposal: jobs vs. triggers, single-flight with
  coalescing, IDLE-first with capability detection and loop fallback, one
  global interval, degraded/backoff, graceful shutdown, status, and an
  on-demand trigger method ready for `5-server-api-auth` to call.
- Keep every job's actual work (training, scanning, folder init) exactly as
  `2-nest-server-foundation` built it — this change only changes *when* and
  *how* jobs run, never what a job does.

**Non-Goals:**
- The HTTP surface for status or on-demand triggers (`5-server-api-auth`'s
  job). This change exposes an injectable `getStatus()`/`triggerNow()`
  surface; nothing serves it over HTTP yet.
- The settings email (`4-mailbox-settings-email`). Folder/threshold/etc.
  settings stay `defaultMailboxSettings` for now, exactly as in
  `2-nest-server-foundation`.
- Multi-mailbox concurrency limits or connection pooling beyond what one
  mailbox naturally uses (still one mailbox from `MailboxRepository` today).
- Per-user rspamd (`6-per-user-bayes`).

## Decisions

### D1. Runner shape: one `MailboxRunner` per mailbox, holding independent per-job state

Replace `MailboxLoopService` with `runtime/mailbox-runner.ts` (`MailboxRunner`,
not itself `@Injectable()` — it's constructed per mailbox, not a singleton;
see D6) and `runtime/runner-registry.ts` (`RunnerRegistry`, the
`@Injectable()`, `OnApplicationBootstrap`/`OnApplicationShutdown` singleton
that creates one `MailboxRunner` per entry from `MailboxRepository.findAll()`
at bootstrap and stops each on shutdown).

Each `MailboxRunner` tracks state **per job**, not one shared state for the
whole mailbox:

```ts
type JobName = 'scan' | 'trainSpam' | 'trainHam' | 'trainWhitelist' | 'trainBlacklist';

interface JobState {
  status: 'idle' | 'running';
  dirty: boolean;              // a trigger fired while running - run once more
  consecutiveFailures: number;
  nextEligibleAt: number;      // epoch ms; 0 = eligible now
  lastRunAt?: number;
  lastResult?: 'success' | 'failure';
  lastError?: string;
}
```

**Alternative considered:** one shared failure/backoff state for the whole
mailbox. Rejected: rspamd being down breaks `scan` and both rspamd-training
jobs, but not `trainWhitelist`/`trainBlacklist` (pure IMAP + state, no
rspamd call) — a shared backoff would needlessly stall list training while
rspamd recovers. Per-job state also gives `5-server-api-auth`'s eventual
"trigger job X" a natural, precise reset target (D5).

### D2. Jobs vs. triggers: a single-flight-with-coalescing wrapper

```ts
private async runJob(job: JobName, fn: () => Promise<void>): Promise<void> {
  const state = this.jobs[job];
  if (state.status === 'running') {
    state.dirty = true;
    return;
  }
  state.status = 'running';
  do {
    state.dirty = false;
    await this.attempt(job, fn);          // one real attempt; see D3 for backoff
  } while (state.dirty && !this.stopped);
  state.status = 'idle';
}
```

Every trigger (interval tick, IDLE `EXISTS`, on-demand call) goes through
`runJob`. This satisfies the proposal's three requirements directly: never
concurrent for the same job (the `status === 'running'` guard), never
dropped (`dirty = true` before returning), never queued N times (`dirty` is
a boolean, not a counter — three triggers while running still produce
exactly one extra run).

**Alternative considered:** a queue/library (e.g. `p-queue` with
concurrency 1). Rejected per the project's own "prefer a library" guidance
weighed against this specific case: the whole mechanism is under 15 lines,
a queue's FIFO semantics are the wrong shape here anyway (coalescing,
not ordering), and a dependency buys nothing a plain flag doesn't already
give.

### D3. Degraded state and backoff live inside `attempt()`, per job

```ts
private async attempt(job: JobName, fn: () => Promise<void>): Promise<void> {
  const state = this.jobs[job];
  if (Date.now() < state.nextEligibleAt) return;  // still backing off, skip silently
  try {
    await fn();
    state.consecutiveFailures = 0;
    state.nextEligibleAt = 0;
    state.lastResult = 'success';
  } catch (err) {
    state.consecutiveFailures++;
    state.nextEligibleAt = Date.now() + backoffMs(state.consecutiveFailures);
    state.lastResult = 'failure';
    state.lastError = err instanceof Error ? err.message : String(err);
    this.logger.error({ mailboxId, job, error: state.lastError }, 'Job failed');
  }
  state.lastRunAt = Date.now();
}

function backoffMs(failures: number): number {
  return Math.min(2 ** failures * 1000, 30 * 60 * 1000); // cap: 30 minutes
}
```

The cap (30 minutes) is the value discussed and accepted during exploration
for connection/auth-style failures: frequent enough to recover quickly from
a transient blip, capped low enough that a real outage doesn't hammer the
IMAP server, high enough that most providers' rate limiting/fail2ban
thresholds aren't tripped by an hourly retry cadence.

A mailbox's overall status (D5) is **derived**, not separately tracked:
`degraded` is true if any job's `consecutiveFailures > 0`, and the
mailbox-level `lastError` is whichever job most recently failed.

Training jobs' own best-effort semantics (`batch-processing-resilience`:
`RspamdTrainingService` never throws; `SenderListTrainingService` does, per
the asymmetry `2-nest-server-foundation` found and preserved) still apply
underneath this: `attempt()` only ever sees a thrown error from
`SenderListTrainingService` or `ScanService`, never from
`RspamdTrainingService`, which is exactly why `trainSpam`/`trainHam` never
enter backoff on a training-folder problem — only on something `attempt()`
itself can't avoid seeing, like the session's own IMAP connect failing
before the job function is even called (see D4).

### D4. Session-per-job stays; a failing connect is itself a job failure

`fn` passed to `runJob`/`attempt` is responsible for opening its own
`MailboxSession` (same `newClient` → `connect()` → resolve folders →
`createMailboxSession` → run → `safeLogout` in `finally` shape
`2-nest-server-foundation`'s `MailboxLoopService` already used, ported
unchanged per D1's "only changes *when*/*how*, never *what*"). If
`newClient(...).connect()` itself throws (bad host, bad credentials,
network down), that exception propagates out of `fn` exactly like a job's
own internal failure, and `attempt()`'s catch block handles it identically
— connection failures and job failures are not distinguished, matching the
proposal's own examples ("connection refused, auth error, rspamd down" all
listed together as "a failing job").

### D5. Status shape

```ts
interface JobStatus {
  lastRunAt?: string;           // ISO
  lastResult?: 'success' | 'failure';
  lastError?: string;
  consecutiveFailures: number;
  nextEligibleAt?: string;      // ISO, only when backing off
}

interface MailboxRunnerStatus {
  mailboxId: string;
  state: 'running' | 'degraded';   // derived: degraded iff any job is backing off
  mode: 'idle' | 'loop';           // which trigger mode this mailbox is in (D6)
  lastError?: string;              // most recent failure across all jobs
  jobs: Record<JobName, JobStatus>;
}
```

`RunnerRegistry.getStatus(): MailboxRunnerStatus[]` exposes this for
`5-server-api-auth`'s health/status endpoints to read later, and for this
change's own tests to assert against directly (no HTTP round-trip needed to
verify it).

### D6. IDLE-first with capability detection, one runner per mailbox but two connections

Each `MailboxRunner`, once its mailbox first connects successfully, checks
`imap.capabilities.has('IDLE')` on that very connection (per the Context
section's confirmed mechanism) and records the mailbox's `mode` for the
rest of the process's lifetime — the proposal is explicit that this is
re-checked only "until the process restarts."

- **`mode: 'idle'`**: the runner opens and holds a **second**, dedicated
  connection (`disableAutoIdle: true`, per Context) for
  `infrastructure/imap/inbox.watcher.ts`'s `waitForNewMail`, running in a
  loop: each `EXISTS` resolution calls `runJob('scan', ...)`, then
  immediately re-arms `waitForNewMail` for the next notification. This
  connection is independent of the short-lived per-job connections D4
  describes — IDLE holds one connection open the whole time; each `scan`
  job's `fn` still opens and closes its own separate connection, exactly as
  today.
- **`mode: 'loop'`**: no second connection; `scan` is triggered only by the
  interval (D7), same as training.

A dropped/errored IDLE connection is handled by re-opening it (with its own
backoff, reusing D3's `backoffMs`) and does **not** change `mode` back to
`'loop'` — per the proposal, only a missing capability does that, checked
once.

The capability check itself happens on the *first* connection opened for
that mailbox (during `RunnerRegistry`'s bootstrap, before folder init even
runs) — reusing that connection's `capabilities` map rather than opening a
third, throwaway connection just to ask.

### D7. One global interval, no separate training interval

The proposal's "What Changes" already settles this ("One global interval...
It is the only trigger for training... also a safety net for scans"); the
"Impact" section's "a separate global training interval may be added
(design)" is resolved here: **no**, keep one interval
(`ScanConfig.scanInterval`, unchanged from `2-nest-server-foundation`).
Splitting it would add a second config key and a second timer for a benefit
this change doesn't need — training folders are typically low-volume, and
riding the same cadence as the scan safety-net keeps the mental model to
one number. Revisit only if real usage shows training needs a different
cadence than scanning.

The interval drives, per mailbox: all four training jobs, and `scan` only
when `mode === 'loop'` (in `'idle'` mode, the interval tick still fires but
its `scan` call is naturally a no-op most of the time via D2's coalescing —
if IDLE already triggered and drained a scan since the last tick, the
interval's own `scan` trigger just finds nothing new; it remains a genuine
safety net against a silently dead IDLE connection, per the proposal).

### D8. On-demand trigger, ready for the API

`MailboxRunner.triggerNow(job: JobName): Promise<void>` bypasses D3's
`nextEligibleAt` check (resets `consecutiveFailures` and `nextEligibleAt`
to 0 first) and calls `runJob` immediately. `RunnerRegistry.triggerNow(
mailboxId, job)` finds the right runner and delegates. Both are plain
injectable methods, unit-tested directly; `5-server-api-auth` later exposes
`triggerNow` behind a mailbox-scoped, authenticated endpoint.

### D9. Graceful shutdown

`RunnerRegistry.onApplicationShutdown()` sets a stopped flag on every
`MailboxRunner` (checked in D2's `do/while` before each re-run, and before
starting any job at all) and clears the interval timer and the IDLE
re-arm loop, matching `2-nest-server-foundation`'s existing "no new job
starts" contract. It does not forcibly abort an in-flight job or its IMAP
connection — the job's own `finally`-block `safeLogout` still runs when
that job's `fn` naturally completes or throws.

### D10. AI failure status (the second new capability)

`domain/ai/ai-failure-tracker.ts`'s `AiFailureTracker` already exists as a
shared singleton (registered in `infrastructure/ai/ai.module.ts` since
`2-nest-server-foundation`, injected into `AiClassificationStep`). This
change adds nothing new to the tracker itself — it already counts
consecutive same-reason failures. What's new: expose its current state
(reason, count, last-failed-at) via a small read method
(`AiFailureTracker.status()` or similar, added to that same class) so it
can be surfaced in `RunnerRegistry`'s status output (a top-level field
alongside the per-mailbox array, since AI is shared across mailboxes, not
per-mailbox) or by a future health endpoint. No alert email exists to
retire in the server (it was never ported — `2-nest-server-foundation`'s
design already excluded it as a Non-Goal), so this decision is purely
additive: read access to state that already exists.

## Risks / Trade-offs

- **[Risk] Two long-lived connections per IDLE-mode mailbox (IDLE +
  whatever job happens to be running) plus short per-job connections could
  approach small per-user IMAP connection limits** on a busy mailbox. →
  Mitigation: per the proposal's own Impact section, typical concurrency is
  2-4, well under Dovecot's default 10 / Gmail's 15; revisit if
  multi-mailbox scaling changes this math.
- **[Risk] A job stuck forever (a hung `fn` that never resolves or
  rejects)** would never release its `status: 'running'` lock, silently
  wedging that job forever. → Mitigation: not solved in this change
  (terminal has no per-step timeout either, beyond `RSPAMD_TIMEOUT_MS`/
  `AI_TIMEOUT_MS`/IMAP's own socket timeout already bounding the calls
  underneath); flagged as a real but pre-existing gap, not introduced here.
- **[Trade-off] Per-job backoff state means the interval tick calls
  `runJob` for every job every time, even ones deep in backoff** — cheap
  (an `if` check in `attempt`), so not worth the complexity of skipping the
  call entirely at the trigger level.
- **[Risk] The IDLE capability check runs once per process lifetime** —a
  server that gains IDLE support after the process started stays in
  `'loop'` mode until restart, exactly as the proposal specifies, but worth
  restating as a known limitation an operator might not expect.

## Migration Plan

`MailboxLoopService`, `runtime/mailbox-loop.service.ts`, and its spec are
deleted, replaced by `MailboxRunner`/`RunnerRegistry`. `app.module.ts`'s
`RuntimeModule` provider list changes accordingly; no other module's public
shape changes. Rollback is reverting this change's commit(s) — nothing
persists state that would need reconciling (all runner state is in-memory,
rebuilt from `MailboxRepository` on every process start).
