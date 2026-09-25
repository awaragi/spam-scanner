# Proposal

## Why

The scanner is heading toward a web app: an HTTP API plus background jobs,
serving several mailboxes. Today it is a single-mailbox loop script with a
hand-rolled dependency container (`core/context.ts` threads config and one
`AiFailureTracker` through every call by hand). NestJS gives real dependency
injection, module boundaries, config handling, lifecycle hooks and an HTTP
layer, all of which later changes build on. This change lays the foundation
and reaches scan/train parity with `terminal/` for one mailbox.

Depends on `1-monorepo-restructure`. Followed by `3-mailbox-runners`,
`4-mailbox-settings-email`, `5-server-api-auth` and `6-per-user-bayes`.

## What Changes

- **Scaffold:** generate `app/server/` with the NestJS 12 CLI (`nest new`),
  choosing **ESM**, which gives **Vitest** and oxlint. Otherwise keep Nest
  defaults (tsc compiler, not SWC or Rspack), then adjust.
- **The `src/` folder structure is agreed.** The user did not want Nest's
  default layout. The structure for `app/server/src/` was discussed and
  approved on 2026-09-24, and is fixed in `design.md` (D1, with conventions in
  D2 and D3). Implementation follows it as written. Any deviation needs the
  user's approval first.
- **Copy, don't share:** domain code (today's pure `services/` and `utils/`)
  and infrastructure code (IMAP, rspamd, AI, state) are copied from
  `terminal/` and then adapted. There is no shared package, because `terminal/`
  is deleted at parity.
- **Tests next to source:** unit tests sit beside the code they test
  (`*.spec.ts`). Pure domain tests stay mock-free. Tests for services with
  dependencies override providers through Nest's testing module instead of
  mocking modules.
- **DI instead of `ctx`:** `createDefaultContext()` and the trailing `ctx`
  parameter disappear. Config sections, gateways (IMAP, rspamd, AI),
  repositories (scanner state, sender lists) and the AI failure tracker become
  injectable providers. Domain code stays plain functions with no Nest
  imports.
- **Config:** zod schemas stay the single source of truth, validated through
  `@nestjs/config`'s Standard Schema support and exposed as typed sections.
  The server's env has only two kinds of keys:
  - **global app settings:** rspamd, the whole AI provider (enabled flag, key,
    model and limits), scan interval, batch sizes, retries, logging, API
    password;
  - **connection info for the one mailbox.**

  Keys that become per-mailbox settings, or that are dropped
  (`AI_USER_PROFILE`, `IMAP_NOTIFY_ADDRESS`, `IDLE_WATCHDOG_MS`, `STATE_KEY_*`
  as config), are not part of the server's env. Per-mailbox settings take
  their defaults from code only, with no env layer (see
  `4-mailbox-settings-email`). Until that change lands, the server uses those
  code defaults directly. The server gets its own `.env.example`, generated
  from the schema.
- **Env migration tool:** a script the operator runs creates the server's
  `.env` from the existing `terminal` `.env`. It keeps only the global settings
  and the mailbox connection info, and renames keys where the server's names
  differ. It never prints values. **Privacy:** the assistant never reads any
  real `.env` file, during implementation or verification. The script is built
  and tested against `.env.example` and fixture files only, and the user runs
  it on the real file.
- **Mailbox registry:** a `MailboxRepository` returns a list of mailboxes,
  with exactly one for now, built from env. A mailbox is `{ id, imap connection,
  state folder }`. `id` is the user's **email address** and is distinct from
  the IMAP login user. The rspamd user for a mailbox is its `id`, internal and
  never user-configurable.
- **Logging:** pino through `nestjs-pino`. Component-scoped loggers, secret
  redaction and the current level choices are kept, and every log line within a
  mailbox's work also carries the mailbox id.
- **Docker:** `app/server/Dockerfile` has a build stage (`nest build`) and a
  runtime stage. A `server` service is added to the root compose file (a
  separate profile), so terminal or server can run against the shared rspamd.
- **Minimal run loop:** so this change ends in a working state, the server runs
  train then scan for the one mailbox on the global interval, with a fresh IMAP
  connection per job. IDLE, single-flight jobs, degraded/backoff handling and
  API triggers come in later changes.

## Capabilities

### New Capabilities

- `server/configuration`: the server's env-sourced config. It covers the
  global-versus-connection split, zod validation at startup with every problem
  reported at once, the generated `.env.example`, and the env migration tool
  with its no-values-printed guarantee.
- `server/mailbox-registry`: the mailbox model (email id, IMAP connection,
  state folder), the repository contract (a list, one entry from env for now),
  and rspamd user = mailbox id.

### Modified Capabilities

_None._ The domain behavior specs (`scan-inbox`, `sender-lists`,
`state-manager`, `ai-spam-escalation`, `batch-processing-resilience`,
`bounded-training-fetch`, `folder-resolution`, `imap-transport-security`,
`logging-levels`) describe behavior the server reproduces unchanged. Where one
names a terminal-only mechanism (a CLI script, `process.exit`), that part stays
terminal-only.

## Impact

- **New package:** `app/server/` (`@nestjs/*` v12, `@nestjs/config`,
  `nestjs-pino`, `zod`, `imapflow`, `mailparser`, `openai`), on Node 24.
- **Root compose:** gains a `server` service. `terminal/` is untouched.
- **Spec organization:** new server capabilities go under `server/`. The
  existing flat specs keep describing `terminal/` until it is retired.
