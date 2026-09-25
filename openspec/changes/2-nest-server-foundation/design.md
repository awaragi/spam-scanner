# Design

## Context

See `proposal.md` for the motivation and scope. The current state that shapes
the approach:

- **Terminal layers.** `terminal/` (after `1-monorepo-restructure`) is layered
  as `core` → `utils` / `services` (pure) → `clients` (I/O) →
  `controllers/steps` → `controllers/workflows`. A hand-rolled `ctx`
  (`core/context.ts`) carries `config` and one `AiFailureTracker` through
  every call.
- **Config.** `core/config.ts` is a zod schema split into documented
  `configGroups`. It also drives `.env.example` generation, with a drift test.
  Logging keys are `docsOnly` there, because the logger has to start before
  config.
- **Folder resolution.** `clients/folder-resolver.client.ts` resolves the
  IMAP hierarchy delimiter and **edits the global `config` in place**,
  rewriting every `FOLDER_*` value. That only works while there is a single
  mailbox.
- **State keys.** State messages use the keys `scanner`,
  `rspamd-whitelist-map` and `rspamd-blacklist-map` in the mailbox's state
  folder. The server must read and write the same format, so it can take over
  from terminal, and hand back to it, without losing state.
- **Toolchain.** NestJS 12 (`@nestjs/cli` 12.x) scaffolds ESM projects with
  Vitest and oxlint, and compiles with tsc by default. Node 24 is in use.

## Goals / Non-Goals

**Goals:**
- Fix the `app/server/src/` folder structure and naming conventions. This is
  the proposal's gate, and the user approved it on 2026-09-24.
- Reach scan and train parity with `terminal/` for one mailbox, with the same
  state format, classification behavior and training semantics.
- Remove `ctx` completely: DI for singletons, and an explicit
  `MailboxSession` argument for per-mailbox data.
- Keep `domain/` pure and mock-free, as `services/` and `utils/` are today.

**Non-Goals:**
- Per-mailbox runners, IDLE, single-flight jobs, degraded/backoff state and
  status (`3-mailbox-runners`). This change ships only a minimal loop.
- The settings email and settings overrides (`4-mailbox-settings-email`).
  This change uses code defaults directly.
- The HTTP API and auth (`5-server-api-auth`). The only HTTP surface is what
  the scaffold provides, and no endpoints are added.
- Per-user Bayes (`6-per-user-bayes`). rspamd calls stay as they are today.
- Porting the AI failure alert email. Per the plan, AI failures become
  status-only in `3-mailbox-runners`, so the alert step and the alert-email
  service are not copied over.
- Porting the prompt-eval tooling (`eval-prompt`, `prompt-eval.controller`,
  `classify-dataset.step`, the `eml-dataset` and `report-file` clients, and
  the `prompt-engineer` skill). It stays in `terminal/` for now, and its fate
  is decided before `terminal/` is retired.
- Porting terminal's CLI and admin scripts. `5-server-api-auth` covers them as
  API endpoints.

## Decisions

### D1. Folder structure (approved)

The layers sit at the top level, with a feature folder inside each layer and a
Nest module per feature. This follows terminal's layered model rather than
Nest's default flat feature folders.

```
app/server/
  src/
    main.ts                      bootstrap: NestFactory, pino logger, shutdown hooks
    app.module.ts                root module, imports everything below

    config/                      @Global ConfigModule
      config.module.ts
      app-config.schema.ts       zod groups: app settings + the one mailbox's connection (env)
      app-config.schema.spec.ts
      app-config.ts              typed sections (RspamdConfig, AiConfig, ScanConfig, ...)
      mailbox-settings.defaults.ts   per-mailbox settings, code defaults only

    logging/
      logging.module.ts          nestjs-pino: levels, format, filters, redaction, mailbox id

    domain/                      PURE: no Nest, no I/O, no config imports
      classification/            spam-classifier.ts, error-classifier.ts
      ai/                        ai-content.ts, ai-error-reason.ts, ai-failure-tracker.ts
      sender-lists/              sender-lists.ts, list-diff.ts
      scanning/                  scan-progress.ts
      state/                     state-format.ts
      utils/                     concurrency.ts, email.ts, email-parser.ts,
                                 mailboxes.ts, ai-content-format.ts, env-file.ts
      (each with its *.spec.ts beside it, zero mocks)

    infrastructure/              I/O adapters, injectable providers
      imap/
        imap.module.ts
        imap-connection.factory.ts   withSession(mailbox, fn): connect, run, safe logout
        mailbox.gateway.ts           open/search/fetch/move/labels/append
        message.mapper.ts            processMessage/processMessageHeaders (pure)
        folder.resolver.ts           delimiter -> resolved folder paths (per mailbox)
        inbox.watcher.ts             IDLE (used from 3-mailbox-runners)
      rspamd/     rspamd.module.ts, rspamd.gateway.ts
      ai/         ai.module.ts, ai.gateway.ts (openai), ai-prompt.ts
      state/      state.module.ts, scanner-state.repository.ts,
                  sender-list.repository.ts   (+ settings.repository.ts in 4-mailbox-settings-email)
      mailboxes/  mailboxes.module.ts, mailbox.repository.ts (env-backed), mailbox.ts

    application/                 use-cases: terminal's workflows + steps
      mailbox-session.ts         { mailbox, imap, settings, folders, logger }
      scanning/
        scanning.module.ts
        scan.service.ts          orchestrates a scan (terminal's scan.controller)
        pending-messages.step.ts, rspamd-check.step.ts, ai-classification.step.ts,
        disposition.step.ts      (label-apply + folder-move + spam-move)
        sender-list-lookup.step.ts
      training/
        training.module.ts
        rspamd-training.service.ts      (train.controller + rspamd-training.step)
        sender-list-training.service.ts (+ list-update.step)
      folders/
        folders.module.ts, folder-init.service.ts   (init.controller)

    runtime/                     this change: minimal loop only; 3-mailbox-runners replaces it
      runtime.module.ts, mailbox-runner.ts, runner.registry.ts, jobs.ts, backoff.ts

    api/                         5-server-api-auth: HTTP only
      api.module.ts
      auth/       auth.controller.ts, token.service.ts, admin.guard.ts, mailbox-scope.guard.ts
      mailboxes/  mailboxes.controller.ts, jobs.controller.ts, settings.controller.ts,
                  state.controller.ts, lists.controller.ts
      health/     health.controller.ts

  scripts/                       plain node scripts, not part of the Nest app
    generate-env-example.ts
    migrate-env.ts               terminal .env -> server .env (operator-run)
  test/
    api/                         later (local IMAP server discussion)
```

Only the folders this change needs are created here. `runtime/` gets the
minimal loop (D9) and `api/` stays absent until `5-server-api-auth`. The Nest
scaffold's sample `app.controller.ts` / `app.service.ts` are deleted, and its
e2e folder is renamed to `test/api/`.

**Alternatives considered:**
- **Nest's default flat feature folders** (`scan/scan.module.ts`,
  `scan.controller.ts`, `scan.service.ts`, ...). Rejected by the user, and
  they blur the pure/impure boundary the project relies on.
- **Strict hexagonal ports/adapters** with interface tokens for every
  adapter. More ceremony than this project needs: concrete classes are enough
  for `overrideProvider` in tests.

### D2. Naming conventions

- **`*.service.ts`** is an injectable use-case (`application/`).
- **`*.step.ts`** is an injectable sub-step used only inside its feature
  folder.
- **`*.gateway.ts` / `*.repository.ts`** is an injectable I/O adapter
  (`infrastructure/`). Repositories persist entities (state, lists, and later
  mailboxes and settings). Gateways talk to systems (IMAP, rspamd, AI).
- **`*.controller.ts`** means HTTP only (`api/`).
- **`domain/` files have no role suffix.** For example,
  `spam-classifier.service.ts` becomes `spam-classifier.ts`, so that
  "service" always means an injectable.
- **Tests** sit beside their source as `*.spec.ts`.

### D3. Dependency direction

`api` → `runtime` → `application` → `infrastructure` / `domain` / `config`.
`infrastructure` may import `domain` and `config`. `domain` imports only
`domain`. This is terminal's invariant, restated for the new layers.

It is enforced with **dependency-cruiser** rules, run as part of
`npm run lint`. That follows the project's preference for a mature library
over hand-rolling. Alternative considered: a custom Vitest test that scans
imports. Rejected, because it is bespoke code doing what dependency-cruiser
already does.

### D4. `ctx` becomes DI plus `MailboxSession`

- **Singletons come from DI:** config sections, gateways, repositories, the
  mailbox repository, and one `AiFailureTracker`. The tracker is global,
  because the AI provider is shared by all mailboxes.
- **Per-mailbox data travels as an explicit argument.** Every use-case and
  step method takes a `MailboxSession`, which holds:
  - the `mailbox` record;
  - the open `ImapFlow` connection;
  - the resolved `settings` (code defaults for now);
  - the resolved `folders` (D6);
  - a pino child logger bound to `{ mailboxId }`.
- **No request-scoped or transient providers.** Nest's request scope is tied
  to HTTP, and per-mailbox fan-out is explicit data, not DI magic.

Alternative considered: `AsyncLocalStorage` holding the current mailbox.
Rejected, because it hides a dependency that the current code deliberately
makes explicit.

### D5. Config

- **Two groups of keys.** `app-config.schema.ts` keeps the `configGroups`
  pattern (zod plus `.describe()`), trimmed to two kinds of key:
  - **app settings:**
    - `RSPAMD_URL`, `RSPAMD_PASSWORD`, `RSPAMD_TIMEOUT_MS`,
      `RSPAMD_ENVELOPE_TRUSTED_HOPS`;
    - `AI_ENABLED`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_MS`,
      `AI_MAX_RETRIES`, `AI_CONCURRENCY`, `AI_MAX_INPUT_TOKENS`,
      `AI_MAX_OUTPUT_TOKENS`, `AI_FAILURE_ALERT_THRESHOLD`;
    - `SCAN_INTERVAL`, `BATCH_SCAN_SIZE`, `BATCH_PROCESS_SIZE`, `MAX_RETRIES`;
    - `LOG_LEVEL`, `LOG_FORMAT`, `LOG_FILTER_INCLUDES`, `LOG_FILTER_EXCLUDES`;
    - `PORT`.
  - **the single mailbox's connection:**
    - `MAILBOX_ID` (the user's email);
    - `MAILBOX_IMAP_HOST`, `MAILBOX_IMAP_PORT`, `MAILBOX_IMAP_USER`,
      `MAILBOX_IMAP_PASSWORD`, `MAILBOX_IMAP_TLS`,
      `MAILBOX_IMAP_ALLOW_INSECURE`;
    - `MAILBOX_STATE_FOLDER`.

  The `MAILBOX_` prefix marks these keys as the temporary env-backed mailbox
  registry, not app settings. They go away when mailboxes move to real
  storage.
- **Validated once, at bootstrap.** Validation runs through `@nestjs/config`
  with Standard Schema, and reports every problem at once. Because validation
  now runs at app bootstrap rather than at module import, the terminal-era
  split between load-time checks and `assertRequiredConfig()` goes away. Tests
  never bootstrap from env: they build providers from fixtures.
- **Logging keys get validated.** They become real validated keys, no longer
  `docsOnly`. `nestjs-pino` is configured asynchronously from
  `ConfigService`, and `bufferLogs: true` covers the logs emitted before
  config is ready.
- **`SPAM_SCANNER_DATA` stays documented but unused by the app,** since it is
  consumed only by Docker Compose.
- **Per-mailbox settings live in code.**
  `config/mailbox-settings.defaults.ts` exports a typed, camelCase
  `MailboxSettings` object with today's defaults:
  - folders;
  - `scanRead`, `scanInitialState`;
  - `processingMode` and the label names;
  - the clean, low and confirmed thresholds;
  - the AI escalation thresholds;
  - `aiEnabled` (the per-mailbox opt-out, default `true`).

  These keys use camelCase because they are no longer env vars.
- **Removed from the schema:** `AI_USER_PROFILE`, `IMAP_NOTIFY_ADDRESS`,
  `IDLE_WATCHDOG_MS`, `STATE_KEY_*`. The state keys become internal constants
  with **unchanged values**, for compatibility with terminal (see Context).

### D6. Folder resolution is per mailbox

`folder.resolver.ts` takes a live session plus the mailbox's folder settings
and **returns** a resolved `MailboxFolders` object, joined with the server's
delimiter. It never edits shared state. The result is cached with the
session's settings for the life of the runner. Alternative considered: keep
the in-place edit. Impossible with more than one mailbox.

### D7. `imap.client.ts` is split up

The pieces go to `imap-connection.factory.ts` (the connection options from
`imap-transport-security` apply unchanged), `mailbox.gateway.ts` (message
operations, always by UID), `message.mapper.ts` (pure mapping) and
`inbox.watcher.ts` (the IDLE code, copied in but not used until
`3-mailbox-runners`). `withSession()` owns the connect / `finally` logout
contract that every CLI script used to repeat.

### D8. Tests

- **Domain specs** are copied with their sources and stay mock-free. Only
  their imports change.
- **Use-case and step specs** port terminal's controller and step test cases
  to `Test.createTestingModule(...).overrideProvider(Gateway)`, **keeping the
  same behavioral assertions**. That preservation is what makes those tests
  worth porting (see memory: behavior tests enable refactors).
- **Gateway and repository specs** port terminal's client tests, mocking only
  the third-party library (`imapflow`, `fetch`, `openai`).
- **Shared fixtures** (`fixtureMailbox()`, `fixtureSession()`,
  `fixtureSettings()`) replace `fixtureContext()`.

### D9. Minimal run loop (temporary)

`runtime/` provides one small `OnApplicationBootstrap` loop. For each mailbox
from the `MailboxRepository` (exactly one), it does the following:

1. Opens a session, resolves the folders, and runs folder init once.
2. Then, every `SCAN_INTERVAL` seconds:
   - runs `train-spam`, `train-ham`, `train-whitelist`, `train-blacklist`;
   - then runs `scan` repeatedly until a pass processes 0 messages.

Each job gets its own session. A failure is logged and the loop waits for the
next tick. The process never exits because of a mailbox. On
`OnApplicationShutdown`, the loop stops starting new jobs and waits for the
in-flight job to finish. `3-mailbox-runners` replaces all of this.

`SCAN_INTERVAL` must be a positive integer here, since single-run and the
`0` = IDLE mode are gone. Its default is 300 seconds.

### D10. Env scripts

- **`scripts/generate-env-example.ts`** renders `app/server/.env.example` from
  `configGroups`. A drift test in `app-config.schema.spec.ts` fails if the
  file is out of date.
- **`scripts/migrate-env.ts --input <terminal .env> --output <server .env>`**
  works as follows:
  - It keeps the app-setting keys as they are.
  - It maps `IMAP_*` → `MAILBOX_IMAP_*` and `FOLDER_STATE` →
    `MAILBOX_STATE_FOLDER`.
  - It derives `MAILBOX_ID` from `IMAP_USER` if that value contains `@`,
    otherwise from `IMAP_NOTIFY_ADDRESS`. If neither works, it writes an empty
    `MAILBOX_ID=` and warns.
  - It drops every per-mailbox or removed key, and fills in schema defaults
    for anything missing.
  - It reuses `domain/utils/env-file.ts` (terminal's `env-file.util`).
  - It prints **only key names and counts, never values.**
  - It is tested against fixture env files. The assistant never reads a real
    `.env`, and the operator runs the script.

Both scripts are compiled together with the app (the build tsconfig includes
`scripts/`) and run from `dist/`, so they share the same module resolution as
`src/`.

### D11. Module format and imports

The code follows the ESM / module-resolution settings of the Nest scaffold.
Terminal's `.ts`-extension imports (`allowImportingTsExtensions`) are
rewritten to the scaffold's style as files are copied in. There is no custom
tsconfig trickery beyond what the scaffold generates.

### D12. Docker and compose

- **`app/server/Dockerfile`** has a build stage (`npm ci`, `nest build`) and a
  slim runtime stage (production dependencies plus `dist/`). It runs as the
  non-root `node` user, as terminal does today.
- **The root `docker-compose.yml`** gains a `server` service under a `server`
  profile. It joins the same project network and depends on healthy rspamd.

## Risks / Trade-offs

- **[Risk] Terminal and server scan the same mailbox at once,** which means
  double moves and state-write races. → Mitigation: the compose `server`
  profile and the docs make it explicit that you stop the terminal service
  before starting the server, and each start is logged with the mailbox id.
- **[Risk] Decorator metadata in the scaffold's ESM/Vitest setup.** Nest DI
  needs `emitDecoratorMetadata`, and Vitest's default transformer may not
  emit it. → Mitigation: check it straight after `nest new`. If specs can't
  resolve injected dependencies, add `unplugin-swc` to the Vitest config
  only, keeping tsc for builds.
- **[Risk] Copied code drifts from terminal** while terminal gets bug fixes.
  → Mitigation: terminal is frozen, and any fix during the transition is
  applied to both, noted in the fixing commit.
- **[Trade-off] The minimal loop drops terminal's backoff and exit-on-failure
  behavior** until `3-mailbox-runners` lands. That's acceptable, since the
  server doesn't replace terminal in production before then.
- **[Risk] dependency-cruiser may not understand ESM path styles out of the
  box.** → Mitigation: configure it against the build tsconfig. If it proves
  unworkable, fall back to documented conventions plus review.

## Migration Plan

1. After this change, the server can run against the real mailbox in place of
   terminal: stop terminal, run `migrate-env.ts` on the terminal `.env`, and
   start the `server` profile. The state format and state keys are identical,
   so scanning resumes from terminal's `last_uid`.
2. **Rollback:** stop the server and start terminal again. Nothing about state
   has changed, so terminal resumes where the server stopped.
3. Terminal is **not** retired by this change.
