# Design

## Context

See `proposal.md` for motivation. This change adds the first HTTP surface to
`app/server/`. Everything the API needs to *do* already exists as injectable
behavior built by changes 2-4:

- `RunnerRegistry` (`runtime/runner-registry.ts`) already exposes
  `getStatus()` (every mailbox's status + shared AI status),
  `triggerNow(mailboxId, job)`, and `updateSettings(mailboxId, overrides)`.
  It does **not** yet expose a single-mailbox status lookup, an on-demand
  folder-init trigger, or a resolved-settings read - this change adds those.
- `MailboxRepository.findAll()` is the list of managed mailboxes (one, from
  env, today). It is the source of truth for "is this a mailbox id we
  manage" during token exchange.
- Scanner state and sender lists are plain IMAP functions
  (`infrastructure/state/scanner-state.repository.ts`,
  `sender-list.repository.ts`) that take a connected `ImapFlow`. The runner's
  own `updateSettings` shows the established pattern for a one-off state
  operation outside a runner: `newClient(mailbox, logger)` → `connect()` →
  do the work → `safeLogout(...)` in `finally`.
- Config is validated once at bootstrap through `@nestjs/config`'s Standard
  Schema support (`config/config.module.ts`, `app-config.schema.ts`), and
  exposed as injectable typed sections (`config/app-config.ts`). Adding auth
  config follows that exact pattern.
- `RspamdGateway` (`infrastructure/rspamd/rspamd.gateway.ts`) talks to
  rspamd's HTTP API; the health check needs a lightweight reachability probe
  against it. `AiFailureTracker.status()` already gives the AI failure
  status the health endpoint reports.

`app.module.ts`'s comment notes `api/` "stays empty until
`5-server-api-auth`" - this change fills it. Nest is already the framework
(`@nestjs/platform-express` is a dependency); no HTTP framework choice is
open. `@nestjs/jwt` is **not** yet a dependency and is added here.

The layering rule (enforced by `depcruise`, `npm run lint:deps`): `api/`
sits above `runtime/`/`application/`/`infrastructure/` and may depend on
them; nothing below `api/` may depend on `api/`.

## Goals / Non-Goals

**Goals:**
- Password → admin token → mailbox token auth, signed with a configured
  secret, with an admin guard and a mailbox-scope guard.
- Admin endpoints: list mailboxes + status, health, read app settings.
- Mailbox endpoints: trigger jobs (incl. folder init), read/update settings,
  read/reset scanner state, read/replace/import/export sender lists, read
  status.
- Zod-validated request bodies through a single validation pipe.
- Unit tests for the auth service, both guards, the validation pipe, the new
  registry/service methods, and each controller's request-to-collaborator
  wiring.

**Non-Goals:**
- API integration / e2e tests against a live IMAP or HTTP stack (proposal
  defers these; `test/api` is acknowledged but out of scope here).
- Refresh tokens, token revocation lists, multiple admin users, or password
  rotation - one admin password, short-lived tokens, re-login on expiry.
- Editing app-level settings over HTTP (env-only, per the spec).
- Rate limiting / lockout on the login endpoint (a real hardening gap, noted
  in Risks, not built here).
- Removing terminal's admin scripts - they go away with `terminal/` in a
  later change; this change only adds their API equivalents.

## Decisions

### D1. Auth configuration as a new typed config section

Add an `apiGroup` to `config/app-config.schema.ts`'s `configGroups` (so
`.env.example` regenerates from it, like every other group) with:

- `API_ADMIN_PASSWORD` - `z.string().min(1)`, **no default** (required,
  same pattern as `MAILBOX_IMAP_PASSWORD`). The single admin secret.
- `API_JWT_SECRET` - `z.string().min(1)`, **no default** (required). HMAC
  signing key for both token types.
- `API_ADMIN_TOKEN_TTL` - `intField(3600)` seconds (1h default).
- `API_MAILBOX_TOKEN_TTL` - `intField(3600)` seconds (1h default).

Add the matching fields to the `AppConfig` interface, and a new
`ApiAuthConfig` class in `config/app-config.ts` (fields `adminPassword`,
`jwtSecret`, `adminTokenTtlSeconds`, `mailboxTokenTtlSeconds`), registered in
`config.module.ts`'s `sections` array. Because both secrets are `.min(1)`
with no default, `AppConfigModule` already fails bootstrap with a
key-naming error when either is missing - satisfying "refuses to start
without an admin password or signing secret" with no extra code.

**Alternative considered:** a dedicated `@nestjs/jwt` `JwtModule.registerAsync`
reading the secret from `ConfigService` directly. Still used (D2), but the
secret and TTLs are surfaced as a typed `ApiAuthConfig` section first so the
auth service reads them the same injectable way every other part of the
server reads config, rather than reaching into `ConfigService` ad hoc.

### D2. `@nestjs/jwt` for signing, HS256, scope in the payload

Add `@nestjs/jwt` (matching the installed `@nestjs/*` v12 line). An `ApiModule`
(or a nested `AuthModule`) imports `JwtModule.registerAsync` with
`useFactory: (cfg: ApiAuthConfig) => ({ secret: cfg.jwtSecret })` and signs
per-call with an explicit `expiresIn`, so the two token types can carry
different lifetimes from one `JwtService`.

Token payloads (the `scope` claim is what the guards branch on):

```ts
// admin token
{ sub: 'admin', scope: 'admin' }              // expiresIn: adminTokenTtlSeconds
// mailbox token
{ sub: mailboxId, scope: 'mailbox', mailboxId } // expiresIn: mailboxTokenTtlSeconds
```

`mailboxId` is carried explicitly (not only as `sub`) so the mailbox-scope
guard reads one obvious field. Verification uses the same secret; an expired
or wrong-secret token throws in `JwtService.verify`, which the guards
translate to `401`.

### D3. `AuthService` + `AuthController`

`api/auth/auth.service.ts` (`@Injectable`), depending on `ApiAuthConfig`,
`JwtService`, and `MailboxRepository`:

- `login(password: string): { token: string }` - compares `password` to
  `config.adminPassword`. Use a constant-time comparison
  (`crypto.timingSafeEqual` over equal-length buffers, length-guarded) to
  avoid a timing oracle. On mismatch throw `UnauthorizedException`. On match
  sign an admin-scope token.
- `exchangeForMailboxToken(mailboxId: string): { token: string }` - confirms
  `mailboxId` is in `MailboxRepository.findAll()`; if not, throw
  `NotFoundException` (unknown mailbox). If so, sign a mailbox-scope token
  for it.

`api/auth/auth.controller.ts`:

- `POST /auth/login` - body `{ password: string }` (zod). Unguarded.
- `POST /auth/mailboxes/:mailboxId/token` - guarded by `AdminGuard`; returns
  the exchanged mailbox token. Admin-only, so a mailbox token presented here
  is rejected by the guard, satisfying "a mailbox token cannot obtain another
  mailbox's token."

### D4. Two guards over one token-verification helper

A single private helper extracts the `Bearer` token from the
`Authorization` header and `JwtService.verify`s it (throwing
`UnauthorizedException` on missing/expired/tampered), returning the decoded
payload. Two guards build on it:

- `AdminGuard` - verifies the token, then requires `payload.scope === 'admin'`.
  Anything else (including a mailbox token) → `UnauthorizedException`.
- `MailboxScopeGuard` - verifies the token, requires
  `payload.scope === 'mailbox'`, then requires `payload.mailboxId ===
  request.params.mailboxId`. A mismatch → `ForbiddenException` (403, the
  token is valid but not for this mailbox); an admin token on a mailbox route
  → `UnauthorizedException` (wrong scope entirely).

Guards are applied per-controller/route with `@UseGuards(...)`. The login
route and the liveness route carry no guard. Implemented as plain
`CanActivate` guards (not Passport) - one dependency (`JwtService`) and a
dozen lines each, matching the codebase's preference for small explicit code
over framework layers.

### D5. Zod validation pipe (Nest 12 Standard Schema)

Add `api/common/zod-validation.pipe.ts`: a `PipeTransform` constructed with a
zod schema that runs `schema.safeParse(value)` in `transform`, throwing
`BadRequestException` (with the flattened issues) on failure and returning
the parsed value on success. Applied with `@Body(new ZodValidationPipe(schema))`
per route. Zod 4 implements Standard Schema, so this is the codebase-native
way to honor the proposal's "validated with zod through Nest 12's Standard
Schema support" without pulling in `class-validator`/`class-transformer`
(neither is a dependency, and the whole server validates with zod already).

Route body schemas live beside their controllers (e.g. `login.schema.ts`,
`settings-update.schema.ts`, `list-replace.schema.ts`). The settings-update
schema reuses the existing `overridableSchema`/`validateOverrides` from
`config/mailbox-settings.schema.ts` - the pipe does shape validation; the
final authoritative validation (including unknown-key warnings) stays in
`RunnerRegistry.updateSettings`, unchanged.

### D6. New `RunnerRegistry` methods for the mailbox API

The API needs three things the registry does not yet expose; add them beside
the existing `getStatus`/`triggerNow`/`updateSettings`, throwing the same
`Unknown mailbox: ${id}` error for an unknown id:

- `getMailboxStatus(mailboxId): MailboxRunnerStatus` - the one mailbox's
  entry (look up the runner, call its `getStatus()`).
- `getMailboxSettings(mailboxId): MailboxSettings` - the runner's currently
  resolved, cached settings. Requires a `MailboxRunner.getSettings()` getter
  returning `this.settings` (additive, no behavior change).
- `triggerInitFolders(mailboxId): Promise<void>` - runs folder
  initialization on demand. `triggerNow` only accepts the five `JobName`s;
  folder init is bootstrap work, not one of the five coalesced jobs. Add a
  `MailboxRunner.triggerInitFolders()` that opens a session and calls
  `folderInitService.initFolders(session)` (the same call bootstrap makes),
  closing the session in `finally`. The registry method delegates to it.

The job-trigger route maps kebab-case job names to the runner's operations:
`scan|train-spam|train-ham|train-whitelist|train-blacklist` →
`triggerNow(id, <JobName>)`, and `init-folders` → `triggerInitFolders(id)`.
An unmapped name is a `BadRequestException` from the route's param
validation.

### D7. A `MailboxAdminService` for state and list IMAP operations

Reading/resetting scanner state and reading/replacing sender lists need a
throwaway IMAP connection, exactly like `RunnerRegistry.updateSettings`
already does. Rather than scatter `newClient`/`safeLogout` across
controllers (which would also break layering by putting IMAP wiring in
`api/`), add `application/mailbox-admin/mailbox-admin.service.ts`
(`@Injectable`), depending on `MailboxRepository` and `PinoLogger`, with a
private `withConnection(mailboxId, fn)` helper (resolve the mailbox from the
repository or throw `Unknown mailbox`, `newClient` → `connect` → `fn(imap)` →
`safeLogout` in `finally`) wrapping:

- `readState(mailboxId)` → `readScannerState(imap, stateFolder)` (or report
  none when absent - catch the "not found" and return `null`).
- `resetState(mailboxId)` → `deleteScannerState(imap, stateFolder)`.
- `readList(mailboxId, 'whitelist'|'blacklist')` →
  `readMapState(imap, stateFolder, <key>)`.
- `replaceList(mailboxId, kind, addresses)` →
  `writeMapState(imap, stateFolder, <key>, addresses)`.

Export and import are the read and replace operations under different route
verbs/response shapes; they do not need distinct service methods. Keeping
this in `application/` (not `api/`) preserves the layering rule and mirrors
where `RunnerRegistry`'s own IMAP-touching `updateSettings` lives (runtime,
above infrastructure).

### D8. `HealthService` and the health/liveness split

`api/health/health.service.ts` (`@Injectable`), depending on `RunnerRegistry`,
`AiFailureTracker`, and `RspamdGateway`:

- Liveness (`GET /health/live`, **unguarded**): returns `{ status: 'up' }`
  only - no mailbox data, no rspamd probe, nothing privileged (spec's
  liveness requirement).
- Health (`GET /admin/health`, **AdminGuard**): `{ status, rspamd:
  'reachable'|'unreachable', ai: <AiFailureTracker.status()>, mailboxes:
  [{ mailboxId, state, mode, lastSuccessfulScanAgeMs }] }`. rspamd
  reachability is a best-effort probe (a lightweight call to rspamd, e.g. its
  `/ping`, added as `RspamdGateway.ping()`); a failed probe reports
  `unreachable` rather than failing the whole request (spec scenario). The
  per-mailbox summary is derived from `RunnerRegistry.getStatus()` - the
  last successful scan age comes from `jobs.scan.lastRunAt` when its
  `lastResult` was `success`.

### D9. Module layout and wiring

New `api/` tree under `app/server/src/api/`:

```
api/
  api.module.ts            # imports AuthModule, aggregates controllers/guards
  auth/    auth.module.ts, auth.service.ts, auth.controller.ts, *.schema.ts
  admin/   admin.controller.ts        (AdminGuard)
  mailbox/ mailbox.controller.ts      (MailboxScopeGuard), *.schema.ts
  health/  health.controller.ts, health.service.ts
  common/  zod-validation.pipe.ts, guards/{admin,mailbox-scope}.guard.ts,
           token payload types
```

`ApiModule` imports `JwtModule` (D2), `RuntimeModule` (for `RunnerRegistry`),
`MailboxesModule` (for `MailboxRepository`), `AiModule` (for
`AiFailureTracker`), `RspamdModule` (for `RspamdGateway`), and the new
`MailboxAdminService`'s module. `AppModule` imports `ApiModule` last (it sits
at the top of the dependency direction, consuming everything below).
`RunnerRegistry`/`AiFailureTracker` must be exported from their modules for
`ApiModule` to inject them; export them where they are not already.

`main.ts` already calls `app.listen(port)` and enables shutdown hooks;
controllers are picked up automatically once `ApiModule` is imported - no
`main.ts` change beyond what already exists.

### D10. Error-to-status mapping

Reuse Nest's built-in HTTP exceptions so no custom filter is needed:
`UnauthorizedException` (401) for missing/expired/wrong-scope tokens and bad
login; `ForbiddenException` (403) for a valid mailbox token on the wrong
mailbox; `NotFoundException` (404) for an unknown mailbox id (thrown by the
service, or translated from the registry's `Unknown mailbox: ...` error);
`BadRequestException` (400) from the zod pipe and unknown job names. The
existing registry methods throw a plain `Error('Unknown mailbox: ...')`; the
mailbox controller/service catches that and rethrows `NotFoundException`, or
(preferred) the new service methods throw `NotFoundException` directly since
they own the mailbox lookup.

## Risks / Trade-offs

- **[Risk] No rate limiting or lockout on `POST /auth/login`** - a brute-force
  path against a single password. → Mitigation: constant-time comparison
  (D3) removes the timing oracle; real rate limiting is deferred (Non-Goals)
  and should be added before any untrusted-network exposure. Flagged, not
  solved.
- **[Risk] Short-lived tokens with no revocation** - a leaked token is valid
  until it expires. → Accepted: TTLs are short and configurable; revocation
  lists are out of scope for a first API. Re-login/re-exchange is the
  recovery path.
- **[Trade-off] The admin token cannot be used directly on mailbox routes** -
  a small extra round-trip (exchange first). → Deliberate (spec requirement):
  keeps the mailbox guard's check trivial and prevents an admin token from
  being a universal key that also matches every mailbox route.
- **[Trade-off] State/list operations open a fresh IMAP connection per
  request** - same cost the runner's `updateSettings` already pays. →
  Acceptable: these are infrequent operator actions, not hot-path traffic;
  reusing the established connect/`safeLogout` pattern keeps them consistent
  and avoids sharing a connection with a live runner.
- **[Risk] rspamd `ping` probe adds a dependency on an rspamd endpoint that
  may differ across versions.** → Mitigation: the probe is best-effort and a
  failure only downgrades the reported status to `unreachable`; it never
  fails the health request or the server.
