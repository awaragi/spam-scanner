# Design

## Context

See `proposal.md` for motivation. `3-mailbox-runners` built `MailboxRunner`,
which today opens every job's `MailboxSession` around a single hardcoded
constant, `defaultMailboxSettings` (`runtime/mailbox-runner.ts`'s
`openSession`) - there is exactly one call site in the whole server that
reads `MailboxSettings` for real work. `MailboxSession.settings` is already
typed as `MailboxSettings` rather than a literal reference to the default,
specifically so this change can resolve stored overrides into that same
shape without touching `MailboxSession`, `ScanService`, either training
service, or `FolderInitService` at all - none of them will change.

The existing per-mailbox state stack this change extends:
- `domain/state/state-format.ts` - state-key constants, `formatAppStateEmail`/
  `formatStateAsEmail`, `parseStateFromEmail`. Adding a new key here is
  additive; nothing existing changes.
- `infrastructure/state/{scanner-state,sender-list}.repository.ts` - both
  already implement "open state folder → search by `X-App-State` header →
  append-before-delete write → highest-UID-wins read", against a specific
  JSON shape. Neither is generic enough to reuse as-is (`scanner-state`
  throws on missing/invalid state and knows about `SCAN_INITIAL_STATE`;
  `sender-list` assumes the payload is a string array) - this change adds a
  third repository following the same shape, for settings overrides.
- `infrastructure/imap/mailbox.gateway.ts`'s `open`/`search`/
  `fetchMessagesByUIDs` - the plain-function IMAP primitives both existing
  repositories build on; the new repository builds on the same ones.

`MailboxRunner.bootstrap()` (added in `3-mailbox-runners` task 3.1) currently
does exactly one thing before folder init: opens the mailbox's first
connection and checks `imap.capabilities.has('IDLE')`. It resolves (does not
reject) on any failure - connect or `initFolders` - and, critically, **is
only ever called once**, from `start()`. If it fails, this mailbox's runner
never starts anything, ever, for the rest of the process's life: no retry,
no backoff, no further attempt. This was an acceptable gap in
`3-mailbox-runners` (nothing depended on bootstrap succeeding beyond folder
init, and a mailbox that can't connect at all can't do anything regardless).
It stops being acceptable once bootstrap is also where settings load: the
proposal's "Until settings are loaded ... no jobs run and the mailbox stays
degraded" requires bootstrap itself to keep retrying, not fail once and go
silent forever. This design closes that gap as part of wiring settings in.

## Goals / Non-Goals

**Goals:**
- Store per-mailbox settings overrides as a message in the mailbox's own
  state folder, following the same append-then-delete/highest-UID-wins
  contract as scanner state and list state.
- Resolve code defaults + validated overrides into the exact `MailboxSettings`
  shape `MailboxSession` already expects, so nothing downstream of
  `MailboxRunner.bootstrap()` changes.
- Validate overrides with zod against a fixed overridable-key set; ignore
  (with a warning) anything global-only or unrecognized, without failing
  the whole read.
- Read once per runner lifetime, cache, and make bootstrap itself
  retry-with-backoff so "settings not yet loaded" is a genuine degraded
  state, not a silent permanent one.
- Expose an update operation: validate → stop the runner → write → start a
  fresh runner that reads the new settings.

**Non-Goals:**
- The HTTP surface for the update operation (`5-server-api-auth`'s job).
  This change exposes an injectable `updateSettings()` method; nothing
  serves it over HTTP yet.
- Multi-mailbox settings storage other than what `MailboxRepository`
  already returns (still one mailbox, from env, today).
- Migrating any existing `terminal` env values into a settings message - the
  proposal is explicit that the current mailbox starts with no settings
  message and runs on defaults.
- Concurrent updates to the same mailbox's settings (last write wins, same
  as every other state write in this codebase already assumes single-writer
  per mailbox).

## Decisions

### D1. A fourth state-key constant and a dedicated `mailbox-settings.repository.ts`

Add `STATE_KEY_MAILBOX_SETTINGS = 'mailbox-settings'` to
`domain/state/state-format.ts`, alongside the existing three constants -
purely additive, no existing key changes.

Add `infrastructure/state/mailbox-settings.repository.ts` with
`readSettingsOverrides(imap, stateFolder, logger?): Promise<Record<string, unknown> | undefined>`
and
`writeSettingsOverrides(imap, stateFolder, overrides: Record<string, unknown>, logger?): Promise<void>`,
structured exactly like `sender-list.repository.ts`'s `readMapState`/
`writeMapState` (open folder read-only → search by header → highest-UID
fetch+parse for read; open read-write → search → append → delete-old for
write) but keyed by `STATE_KEY_MAILBOX_SETTINGS` and returning/accepting a
plain JSON object rather than a string array. `readSettingsOverrides`
returns `undefined` (not throwing, not defaulting to `{}`) when no message
exists or the stored JSON fails to parse as an object - "no settings
message" and "unparseable settings message" both mean "run on defaults",
per the spec's "its absence is a valid, permanent state, not an error."

**Alternative considered:** generalizing `sender-list.repository.ts` into a
shared "arbitrary JSON state" repository both list state and settings share.
Rejected: `readMapState`'s empty-array default and array-only parsing are
specific to list state's semantics ("no list" and "empty list" are the same
thing); settings' "no message" and "message with a threshold of zero" are
not the same thing and must stay distinguishable (`undefined` vs. `{}`).
Forcing both through one function would need a mode flag that's really just
two functions wearing a trench coat.

### D2. Overridable-key validation: a zod schema over the resolved (camelCase) shape, not a raw-env schema

Unlike `app-config.schema.ts` (which parses raw environment *strings*, hence
`intField`/`boolField`'s string-preprocessing), a settings message already
contains real JSON values (numbers, booleans, strings) written by the
server's own update operation. `config/mailbox-settings.schema.ts` defines a
zod schema over the *already-typed* `MailboxSettings` shape:

```ts
const overridableSchema = z.object({
  folders: z.object({
    inbox: z.string(), spam: z.string(), spamLow: z.string(),
    spamHigh: z.string(), trainSpam: z.string(), trainHam: z.string(),
    trainWhitelist: z.string(), trainBlacklist: z.string(),
  }).partial(),
  scanRead: z.boolean(),
  scanInitialState: z.enum(['new', 'all']),
  processingMode: z.enum(['label', 'folder']),
  labels: z.object({ spamLow: z.string(), spamHigh: z.string() }).partial(),
  thresholds: z.object({
    clean: z.number(), low: z.number(), confirmed: z.number(),
  }).partial(),
  aiEscalation: z.object({
    toLowThreshold: z.number(), toHighThreshold: z.number(),
  }).partial(),
  aiEnabled: z.boolean(),
}).partial();
```

Every top-level key is optional (a settings message may override just one
thing), and the three nested groups (`folders`, `labels`, `thresholds`,
`aiEscalation`) are themselves partial, so a message can override e.g. just
`thresholds.clean` without repeating `low`/`confirmed`. `MailboxFolderSettings`/
`MailboxLabelSettings`/`MailboxThresholdSettings`/`MailboxAiEscalationSettings`
(already exported from `config/mailbox-settings.defaults.ts`) give this
schema's field names a single source of truth to stay in sync with.

**Unknown/global-only keys**: parse with `.passthrough()` first to see
everything the message actually contained, then diff the passthrough
result's top-level keys against `overridableSchema`'s own `.shape` keys -
anything extra is logged as a warning (`logger.warn({ mailboxId, key },
'Ignoring unrecognized or global-only settings key')`) and dropped before
the validated, `.strip()`-parsed result is merged over defaults. A key that
exists but has the wrong type (e.g. `thresholds.clean: "thirty"`) fails
`overridableSchema`'s own type check - per the spec's "a threshold of the
wrong type" scenario - and the whole update is rejected (for the *write*
path, D4 below); for the *read* path, an unparseable stored override is
treated the same as "no settings message" (D1's `undefined`-on-failure),
logged as an error rather than silently defaulting, since a message that
was valid when written and no longer parses indicates real corruption worth
flagging distinctly from "never configured."

### D3. Resolution: a plain deep-merge function, not zod's own merge

`resolveMailboxSettings(overrides: OverridableSettings | undefined):
MailboxSettings` in `config/mailbox-settings.defaults.ts` (beside
`defaultMailboxSettings`) does a one-level-deep merge: each of the four
nested groups (`folders`, `labels`, `thresholds`, `aiEscalation`) is
object-spread over its own default group; top-level scalars
(`scanRead`, `scanInitialState`, `processingMode`, `aiEnabled`) fall back to
the default only when `undefined`. `undefined` passed in (no settings
message at all) returns `defaultMailboxSettings` unchanged - this function
is also what "a mailbox with no settings email uses defaults exactly"
resolves to, satisfying that scenario directly rather than via a separate
code path.

**AI opt-out asymmetry (spec requirement, not this function's job):** this
function resolves `aiEnabled` as a plain override-or-default boolean - it
does NOT know about the global `AiConfig.enabled` flag. The "opt-out can
only turn AI off, never on" rule is enforced where both values are already
in scope: `application/scanning/ai-classification.step.ts`'s existing
`settings.aiEnabled && globalAiConfig.enabled` check (added in
`2-nest-server-foundation`) already implements exactly this AND-of-two-flags
semantics unchanged - re-verified against that file, no edit needed there.
This design decision exists only to record that fact so a future reader
doesn't go looking for opt-out logic inside `resolveMailboxSettings` itself.

### D4. Bootstrap loads settings before folder resolution, and now retries with backoff

`MailboxRunner.bootstrap()` changes shape:

```ts
private async bootstrap(): Promise<{ folders: MailboxFolders } | undefined> {
  let session; // raw imap connection, not yet a full MailboxSession
  try {
    imap = newClient(this.mailbox, this.logger);
    await imap.connect();

    const rawOverrides = await readSettingsOverrides(imap, this.mailbox.stateFolder, this.logger);
    this.settings = resolveMailboxSettings(validateOverrides(rawOverrides, this.logger));

    const folders = await resolveMailboxFolders(imap, { ...this.settings.folders, state: this.mailbox.stateFolder });
    const session = createMailboxSession({ mailbox: this.mailbox, imap, settings: this.settings, folders, logger: this.logger });
    await this.folderInitService.initFolders(session);

    this.mode = imap.capabilities.has('IDLE') ? 'idle' : 'loop';
    this.bootstrapFailures = 0;
    return { folders };
  } catch (error) {
    this.bootstrapFailures++;
    this.logger.error(..., 'Mailbox bootstrap (connect + settings + folder init) failed');
    return undefined;
  } finally {
    if (imap) await safeLogout(imap, this.logger);
  }
}
```

Reading settings happens on the *mailbox's own fixed state folder*
(`this.mailbox.stateFolder` - connection info, never overridable, per D1's
scope and the existing `Mailbox` interface) - **before** `this.settings` is
resolved, so `resolveMailboxFolders` can use the now-resolved
`this.settings.folders` for every other folder. This is why settings must
load strictly before folder resolution, not after: folder resolution is
itself parameterized by settings.

`this.settings` starts as `defaultMailboxSettings` (a sensible initial value
so `getStatus()`/any pre-bootstrap access never sees `undefined`) and is
only ever reassigned here, once per successful bootstrap - matching the
spec's "read once ... cached... not re-read on every job run."

**Bootstrap retry with backoff (closes the Context section's gap):**
`start()` no longer calls `bootstrap()` exactly once and gives up on
failure. Instead:

```ts
async start(): Promise<void> {
  while (!this.stopped) {
    const result = await this.bootstrap();
    if (result) {
      this.startInterval();
      if (this.mode === 'idle') void this.runIdleLoop(result.folders.inbox);
      return;
    }
    if (this.stopped) return;
    await this.sleep(backoffMs(this.bootstrapFailures));
  }
}
```

reusing the same module-level `backoffMs()` and the same `sleep()` helper
`runIdleLoop`'s reconnect already uses (D3-of-`3-mailbox-runners`), and a
new `bootstrapFailures` counter separate from both the five `JobState`
counters and `idleFailureCount`. `getStatus()`'s existing `degraded`
derivation (`any job's consecutiveFailures > 0`) is extended with one more
condition: `state: (degraded-by-job || bootstrapFailures > 0) ? 'degraded' :
'running'` - a mailbox that has never once bootstrapped successfully reports
degraded from the very first failure, exactly like a job does, satisfying
the spec's "no job runs ... mailbox is reported as degraded ... keeps
retrying ... never gives up or exits."

**Alternative considered:** treating "bootstrap" as a sixth `JobName`
running through the existing `runJob`/`attempt` machinery unchanged.
Rejected: `runJob`'s single-flight/coalescing exists to dedupe *triggers*
(interval tick vs. IDLE vs. on-demand) for jobs that can be triggered from
multiple places concurrently; bootstrap has exactly one caller (`start()`'s
own loop) and is never triggered externally, so the coalescing half of that
machinery is pure unused complexity here - a plain retry loop mirroring the
IDLE reconnect loop's own shape (which has the identical "one caller, retry
with backoff, no coalescing needed" profile) is simpler and more honest
about what's actually happening.

### D5. Update operation: validate, stop, write, replace the runner

`RunnerRegistry.updateSettings(mailboxId: string, overrides: Record<string, unknown>): Promise<void>`:

1. Look up the existing runner (throw `Unknown mailbox: ...` if absent,
   matching `triggerNow`'s existing precedent from `3-mailbox-runners` D8).
2. Validate `overrides` against `overridableSchema` (D2) - unknown/global-only
   keys are dropped with a warning exactly as the read path does, but a
   *type* failure on a recognized key rejects the whole call (throws), per
   the spec's "an invalid update is rejected... no settings message is
   written... left unaffected" - nothing below this step runs.
3. Call `existingRunner.stop()` (already idempotent/non-forcible, per
   `3-mailbox-runners` D9 - no in-flight job is aborted).
4. Open one throwaway connection (`newClient`/`connect`), write the
   validated overrides via `writeSettingsOverrides` (D1) against
   `mailbox.stateFolder`, `safeLogout` in `finally`. This is a plain
   function call, not routed through any `MailboxRunner` - the runner being
   replaced has no further use once stopped.
5. Construct a brand-new `MailboxRunner` for the same `Mailbox` and call
   `.start()` on it (which runs `bootstrap()` fresh, reading the
   just-written settings - there is no separate "refresh the cache" step
   because a new runner has no stale cache to refresh).
6. Replace the map entry (`this.runners.set(mailboxId, newRunner)`) only
   after the new runner's `start()` has been *initiated* (not necessarily
   resolved - `start()`'s own bootstrap-retry loop, D4, means it may still
   be retrying a flaky connection; the map entry should point at the new
   runner as soon as it exists, so `getStatus()`/`triggerNow` calls arriving
   during that retry correctly see the new, possibly-degraded runner rather
   than either the stopped old one or nothing).

**Hand-edit overwrite semantics** (spec's explicit scenario) fall out of
this for free: step 4 always writes a complete overrides object assembled
from this call's own validated input, never reading-then-merging the
currently-stored message first - there is no code path that would preserve
a hand-edited value the server itself didn't just validate.

**Alternative considered:** mutating the existing `MailboxRunner`'s
`this.settings` in place after a stop, then calling a resumed `start()` on
the same instance instead of building a new one. Rejected: `MailboxRunner`
already has per-job `JobState` (failure counts, `nextEligibleAt`) and IDLE
mode accumulated over its lifetime; silently resuming the same instance
would carry that history across an operator-initiated settings change that
has nothing to do with it (e.g., a job's backoff clock from before the
update would keep counting after). A fresh instance starts every piece of
state clean, which is what "start a new runner" in the proposal's own
wording already implies.

## Risks / Trade-offs

- **[Risk] A settings message that fails to parse (D2's "corruption" case)
  logs an error and falls back to defaults, silently changing a mailbox's
  effective behavior** (e.g., a custom threshold reverting to default)
  until an operator notices the error log and re-applies the update. →
  Mitigation: not solved here: no repair/quarantine mechanism exists yet
  (there's nowhere to surface it more prominently until
  `5-server-api-auth`'s status endpoint exists); flagged as a real but
  deferred gap rather than papered over.
- **[Risk] Bootstrap retrying forever on a permanently bad mailbox
  (deleted account, revoked credentials) never stops trying**, same
  accepted trade-off as every other backoff loop in this system (per
  `3-mailbox-runners`'s own "no per-step timeout" risk) - capped backoff
  keeps the cost low, but there is still no operator-visible "give up"
  state. Not newly introduced by this change; restated because bootstrap
  now retries where before it silently stopped forever (a strictly better,
  but still imperfect, outcome).
- **[Trade-off] `updateSettings` replaces the whole runner rather than
  hot-swapping settings on the live one** - simpler and safer (D5's
  alternative-considered), at the cost of a job's in-flight backoff state
  being discarded on every settings update, even one unrelated to whatever
  was failing. Acceptable: settings updates are expected to be rare,
  operator-initiated events, not routine.
