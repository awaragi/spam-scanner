# Convert spam-scanner to TypeScript

**Instruction: as you complete each step below, edit this file and flip its checkbox
from `- [ ]` to `- [x]`. Keep this file up to date in real time as you work through it,
not in a batch at the end - it's the progress record for this conversion, and a fresh
session should be able to read it and know exactly what's done and what's left.**

Convert the spam-scanner codebase (Node.js ESM IMAP spam scanner) from vanilla JS to
TypeScript, as an interim step toward an eventual NestJS + Angular rewrite. Work on the
branch `explore/typescript-conversion` (created off `master`).

## Locked architecture decisions (do not revisit)

- Literal port: keep every file's role and the five-layer structure exactly as CLAUDE.md
  defines it (`core`, `utils`, `services`, `clients`, `controllers/workflows`,
  `controllers/steps`). No restructuring toward Nest's shape yet.
- `ctx` stays a plain object threaded as a trailing parameter through
  `controllers/workflows/*.controller.ts` (`ctx: Context = createDefaultContext()`) - no
  shift to classes or a DI container.
- `controllers/steps/*.step.ts` stay controller-internal orchestration units, not a
  separate architectural layer.
- In the user's target Nest architecture, "Controller" means orchestrator (calls
  stateless services/utils + stateful IO repositories/clients) - matches this codebase's
  existing `controllers/workflows` role already, so no renaming needed there. `clients/`
  may conceptually map to "repositories" later; don't rename now.
- Explicit TypeScript interfaces/types replace JSDoc as the source of truth - not
  `checkJs`/JSDoc typing.
- No spec changes: this is a pure language/tooling migration, identical runtime behavior,
  validated by the existing test suite (mocks only at the client boundary) plus one final
  manual smoke test.

## Process for this session

1. **Phase 0 (below) renames every `.js` file to `.ts` and fixes every import
   specifier repo-wide in one upfront pass**, before any typing work starts. Do not
   rename file-by-file per layer this time - the rename and the typing are now two
   fully separate passes.
2. **After Phase 0, the whole repo is expected to be red**: `npx tsc --noEmit` and
   `npm run lint` will report errors across every file, since nothing has real types yet
   (a `.ts` file with no type annotations is just JS with a different extension, so
   `npm test` should still pass - only type-checking/linting go red). This is normal, not
   a sign something broke.
3. **Then work layer by layer**, adding real types and fixing whatever `tsc`/`eslint`
   flag in that layer's files, in dependency order - but follow actual imports, not just
   the nominal layer label, when a file crosses layers unusually (see exceptions below).
   Nominal order: `core` -> `utils` -> `services` -> `clients` ->
   `controllers/steps` + `controllers/workflows` -> `admin` -> `cli`. Type each file's
   test alongside it.
4. **After each layer**, the gate is *scoped to that layer's files*, since the rest of
   the repo won't be clean until its own turn comes:
   - `npx vitest run test/unit/<layer>` (or the relevant test paths) - green
   - `npx tsc --noEmit 2>&1 | grep <layer's file paths>` - no output (errors elsewhere
     are expected and not this layer's problem yet)
   - `npx eslint <layer's file paths>` - clean
5. **Introduce TypeScript models/interfaces as needed**, driven by actual type errors,
   not a big upfront type-design pass. Prefer small, per-function/module-local structural
   interfaces over a shared "domain model" file (see notes below on why).
6. **Do not clean up JSDoc during the typing pass at all.** Leave every JSDoc block fully
   intact - including `@param {type}`/`@returns {type}` annotations - through every layer
   below. The dedicated cleanup pass happens only after everything is converted, green,
   and **committed** (see "JSDoc cleanup" below) - that commit is the restart point if
   the cleanup pass needs to be redone or aborted.

## Known dependency-order exceptions (don't get surprised)

These affect the order you add *types* in (Phase 0 already renamed everything, so this
is about typing order, not renaming order):

- `core/context.ts` imports `services/ai-failure-tracker.service.ts` (which imports
  `services/ai-error-reason.service.ts`) - type both service files as part of the `core`
  layer pass, before `context.ts`.
- `core/config.ts`'s own test (`config.test.ts`) imports `utils/env-file.util.ts` (the
  `.env.example` drift-guard test) - type that util as part of the `core` layer pass too.
- `test/support/fixtures.ts` and `test/support/fake-clients.ts` are first imported by
  `test/unit/controllers/{steps,workflows}/**` - type them right before the controllers
  layer, not deferred to the very end.

## Phase 0: Bulk rename, import fixes, and tooling setup (do this all upfront, once)

### Rename

- [x] `git mv` every `.js` file under `src/` to the same path with a `.ts` extension
  (all of `core`, `utils`, `services`, `clients`, `controllers/steps`,
  `controllers/workflows`, `admin`, `cli`).
- [x] `git mv` every `.js` file under `test/` to `.ts` (`test/unit/**`,
  `test/support/**`, and `test/integration/**`).
- [x] Confirm with `find src test -name '*.js'` that it now returns nothing.

### Fix every reference repo-wide

- [x] `grep -rn "\.js'" src test | grep -v node_modules` (and the `"..."` double-quote
  variant) to find every remaining relative-import specifier still pointing at a `.js`
  path, then fix each one to `.ts`. Do this as a small scripted pass (e.g. `sed` per
  matched file) rather than by hand one at a time, and re-run the grep afterward until
  it returns nothing.
- [x] Update `package.json` script paths (`start`, `generate:env-example`) from `.js` to
  `.ts`.
- [x] Update `bin/local/start.sh`'s default script path
  (`SCRIPT="${2:-src/cli/orchestrator.js}"`) to `.ts`.
- [x] Grep for any other `.js` path references to `src/`/`test/` files outside those two
  places (docs, other shell scripts, `bin/local/check-eml.sh`, etc.) and fix them too.
  (Fixed README.md, ROADMAP.md, bin/docker/entrypoint.sh,
  .claude/skills/prompt-engineer/SKILL.md, skills/prompt-engineer/SKILL.md;
  `bin/local/check-eml.sh` had no such references; openspec archive docs left untouched
  as historical records.)

### Tooling setup

- [x] `npm install --save-dev typescript typescript-eslint @types/node`
- [x] Add `tsconfig.json`:
  ```json
  {
    "compilerOptions": {
      "target": "ES2023",
      "lib": ["ES2023"],
      "module": "preserve",
      "moduleResolution": "bundler",
      "strict": true,
      "noEmit": true,
      "allowImportingTsExtensions": true,
      "esModuleInterop": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "skipLibCheck": true,
      "verbatimModuleSyntax": true,
      "types": ["node", "vitest/globals"]
    },
    "include": ["src/**/*.ts", "test/**/*.ts"]
  }
  ```
  Important: use `module: "preserve"` + `moduleResolution: "bundler"`, NOT `NodeNext`.
  `NodeNext` triggers a real bug in `pino`'s CJS/ESM-interop type declarations under
  `verbatimModuleSyntax` (`import pino from 'pino'` resolves to a non-callable
  namespace type - "This expression is not callable"). Since `noEmit: true` means Node's
  own runtime resolution (not tsc) handles all actual module loading,
  `moduleResolution` only affects type-checking, not runtime - `bundler` resolution
  works correctly here and sidesteps the pino bug. Verified working in a throwaway
  repro before adopting.
- [x] Add `"type-check": "tsc --noEmit"` to `package.json` scripts.
- [x] `eslint.config.js`: import `typescript-eslint`, use the `tseslint.config(...)`
  wrapper (not a plain array), and add `tseslint.configs.recommended` scoped to
  `files: ['**/*.ts']` via a nested `extends: [...]` block. Since every file is now
  `.ts` after the rename above, this will apply repo-wide immediately and surface real
  (pre-existing) issues everywhere at once - expected, fixed layer by layer along with
  the typing work, not a sign the config is wrong. Keep the existing vitest-globals
  block, updated to match `test/**/*.ts`.
- [x] `vitest.config.js` and `vitest.integration.config.js`: since every test file is
  already `.ts` after the rename, set `include` to `test/**/*.test.ts` (and the
  integration equivalent) and coverage `include` to `src/**/*.ts` directly - no need for
  a transitional `{js,ts}` glob.
- [x] Layer gate for Phase 0 itself: `npm test` passes (untyped `.ts` files still run
  fine), confirming the rename + import fixes didn't break anything at runtime.
  (48 files, 500 tests, all green.)

## Layer: `core` (3 files, + 2 pulled-forward services + 1 pulled-forward util)

Add real types to (files already renamed to `.ts` in Phase 0):

- [x] `services/ai-error-reason.service.ts` (+ test)
- [x] `services/ai-failure-tracker.service.ts` (+ test)
- [x] `utils/env-file.util.ts` (+ test)
- [x] `core/config.ts` (+ test)
- [x] `core/logger.ts` (+ test)
- [x] `core/context.ts` (+ test)
- [x] Layer gate (scoped): tests, `tsc`, `eslint` clean for the files above
  (also fixed eslint.config.js: `@typescript-eslint/no-unused-vars` needed its own
  `argsIgnorePattern`/`varsIgnorePattern` config since it doesn't inherit the base
  `no-unused-vars` options - base rule now `off` for `.ts` files.)

## Layer: `utils` (5 remaining files)

- [x] `ai-content.util.ts` (+ test)
- [x] `concurrency.util.ts` (+ test)
- [x] `email.util.ts` (+ test)
- [x] `email-parser.util.ts` (+ test)
- [x] `mailboxes.util.ts` (+ test)
- [ ] Add a small local `.d.ts` for `mailparser`'s `simpleParser` shape (only what's
  actually used) if `email-parser.util.ts` or `eml-dataset.client.ts` needs it
  (deferred: `email-parser.util.ts` doesn't import `mailparser` at all - only
  `eml-dataset.client.ts`, in the `clients` layer, does; revisit there)
- [x] Layer gate (scoped): tests, `tsc`, `eslint` clean for the files above
  (82 tests passing, tsc/eslint clean for src/lib/utils/*.ts and test/unit/utils/*.ts)

## Layer: `services` (9 remaining files)

- [x] `alert-email.service.ts` (+ test)
- [x] `error-classifier.service.ts` (+ test)
- [x] `sender-lists.service.ts` (+ test)
- [x] `list-diff.service.ts` (+ test)
- [x] `spam-classifier.service.ts` (+ test)
- [x] `state-format.service.ts` (+ test)
- [x] `scan-progress.service.ts` (+ test)
- [x] `ai-content.service.ts` (+ test) - added `src/lib/types/mailparser.d.ts` (local
  module declaration for `mailparser`'s `simpleParser`/`ParsedMail`, which ships no
  types of its own) since this file needed it, not just the originally-flagged
  `eml-dataset.client.ts`
- [x] `prompt-eval-report.service.ts` (+ test)
- [x] Layer gate (scoped): tests, `tsc`, `eslint` clean for the files above
  (164 tests passing)

## Layer: `clients` (7 files)

- [x] `ai.client.ts` (+ test)
- [x] `eml-dataset.client.ts` (no test file exists for it)
- [x] `folder-resolver.client.ts` (+ test)
- [x] `imap.client.ts` (+ test) - real `imapflow` types used throughout; found and
  preserved (not fixed - out of this migration's scope) two pre-existing gaps
  between imapflow's own `.d.ts` and its real runtime behavior: `mailboxExpunge()`
  doesn't exist on `ImapFlow` at all (only called by `moveMessage()`, which has no
  callers anywhere in the codebase - dead code, cast with a comment), and
  `messageFlagsAdd`/`messageFlagsRemove`'s `range.uid` types as a single
  `SequenceString` but its real implementation accepts (and joins) a `uid: number[]`
  array too (cast with a comment). Also found `state-manager.client.ts` reads
  `messages[0].body`, a field `fetchMessagesByUIDs` doesn't return (only
  `uid`/`flags`/`envelope`/`raw`) - preserved as-is (see that file's
  `FetchedMessageWithBody` comment) since fixing it would change runtime behavior;
  flagged to the user as a likely real bug worth a separate follow-up.
- [x] `report-file.client.ts` (+ test)
- [x] `rspamd.client.ts` (+ test)
- [x] `state-manager.client.ts` (+ test)
- [x] Layer gate (scoped): tests, `tsc`, `eslint` clean for the files above
  (82 tests passing)

## Pulled-forward: `test/support` (before controllers layer)

- [x] `test/support/fixtures.ts` - `fixtureContext()` returns only the `Config`
  fields controllers actually read (project convention, per its own doc comment),
  not every field the real `Config` interface declares, so its return is cast to
  `Context` rather than satisfying it structurally.
- [x] `test/support/fake-clients.ts`

## Layer: `controllers/steps` (11 files)

- [x] `ai-classification.step.ts` (+ test)
- [x] `ai-failure-alert.step.ts` (+ test)
- [x] `classify-dataset.step.ts` (+ test) - widened `ai-content.service.ts`'s
  `EnvelopedMessage.uid` and `core/logger.ts`'s `forMessage(uid)` to
  `number | string`, since dataset messages use string uids (`bucket/filename`)
  while IMAP messages use numeric ones
- [x] `folder-move.step.ts` (+ test)
- [x] `label-apply.step.ts` (+ test)
- [x] `list-update.step.ts` (+ test)
- [x] `pending-messages.step.ts` (+ test)
- [x] `rspamd-check.step.ts` (+ test) - extended `src/lib/types/mailparser.d.ts`
  with `ParsedMail.headers: Map<string, unknown>` and `simpleParser`'s options
  param, needed for this file's `mailparser` usage
- [x] `rspamd-training.step.ts` (+ test)
- [x] `sender-list-lookup.step.ts` (+ test)
- [x] `spam-move.step.ts` (+ test)
- [x] Layer gate (scoped): tests, `tsc`, `eslint` clean for the files above
  (58 tests passing). Used the shared `asImapFlow`/`createNoOpRootLogger` test
  helpers (from `test/support/`) throughout instead of re-deriving per-file casts.

## Layer: `controllers/workflows` (6 files)

- [x] `idle.controller.ts` (+ test)
- [x] `init.controller.ts` (+ test)
- [x] `prompt-eval.controller.ts` (+ test)
- [x] `scan.controller.ts` (+ test) - the pipeline's unification point: defined one
  concrete local `ScanMessage` interface, cast `fetchMessagesByUIDs`'s `unknown`
  flags/envelope to it once at the top, then let generic inference flow through
  every downstream step/service call. Exported `AiFailureAlert` from
  `ai-failure-alert.step.ts` and cast at the one call site where it meets
  `ai-classification.step.ts`'s looser (nullable-field) `FailureAlert` type -
  both are real, by the time `shouldAlert` is true the fields are always set.
- [x] `sender-list-training.controller.ts` (+ test)
- [x] `train.controller.ts` (+ test)
- [x] Layer gate (scoped): tests, `tsc`, `eslint` clean for the files above
  (35 tests passing)

## Layer: `admin` (11 files)

- [x] `delete-state.ts` (already typed cleanly as-is; no test file)
- [x] `export-list.ts` (+ test) - installed `@types/yargs`; yargs' `.argv` types as
  `T | Promise<T>`, so switched to `await yargs(...).argv` (the standard idiom) at
  every CLI/admin call site using yargs
- [x] `export-mailbox-state.ts` (+ test)
- [x] `import-list.ts` (+ test)
- [x] `import-mailbox-state.ts` (+ test)
- [x] `list-all.ts` (no test file)
- [x] `read-email.ts` (no test file)
- [x] `read-state.ts` (no test file) - widened `state-manager.client.ts`'s
  `readScannerState`'s `defaultState` param to optional (`defaultState?:
  ScannerState`), matching its real 1-arg call sites
- [x] `reset-state.ts` (already typed cleanly as-is; no test file)
- [x] `uid-on-date.ts` (no test file)
- [x] `write-state.ts` (already typed cleanly as-is; no test file)
- [x] Layer gate (scoped): tests, `tsc`, `eslint` clean for the files above
  (32 tests passing)

## Layer: `cli` (9 files)

- [x] `eval-prompt.ts` - dynamic `.option()` loop plus `await` on `.argv`, matching
  the other yargs-based CLI/admin scripts
- [x] `generate-env.ts`
- [x] `init-folders.ts` (already typed cleanly as-is)
- [x] `orchestrator.ts` - `runStep()` dispatches workflow functions with different
  trailing-arg shapes (`(imap, ctx)` vs `(imap, options, ctx)`); typed generically
  as `WorkflowFn<T> = (imap: ImapFlow, ...args: any[]) => Promise<T>` with an
  eslint-disable for the one deliberate `any` (a CLI entry point, not consumed
  elsewhere)
- [x] `scan-inbox.ts` (already typed cleanly as-is)
- [x] `train-blacklist.ts` (already typed cleanly as-is)
- [x] `train-ham.ts` (already typed cleanly as-is)
- [x] `train-spam.ts` (already typed cleanly as-is)
- [x] `train-whitelist.ts` (already typed cleanly as-is)
- [x] Layer gate: full `npm test`, `npx tsc --noEmit`, `npm run lint` all green
  repo-wide (this is the last layer, so the gate is no longer scoped - everything
  should be clean now). Also fixed two implicit-any params in
  `test/integration/ai-live-classification.test.ts`, the one file outside every
  named layer that `tsc`'s repo-wide `test/**/*.ts` glob still covered.
  500/500 unit tests passing, `tsc --noEmit` and `npm run lint` both clean
  with zero output.

## TypeScript gotchas already discovered (to move faster this time)

- **Dynamic zod-schema merging erases field types.** `config.js` builds its schema via
  `configGroups.reduce((acc,g) => acc.merge(g.schema), z.object({}))` - this collapses
  precise field inference. Fix: hand-write an explicit `Config` interface as the
  authoritative type (don't fight `z.infer` here), and inside `.superRefine()`
  callbacks, cast the received data to that interface locally rather than fighting
  zod's inference.
- **`utils/` must never import types from `core/`** (or vice versa) per CLAUDE.md's
  layering. A shape used by both (e.g. the `{title, schema}` "config group" shape needed
  by both `core/config.ts` and `utils/env-file.util.ts`) should be declared
  independently/structurally in each file - TS structural typing makes this free, no
  shared import needed.
- **Ad-hoc error properties** (`err.permanent`, `err.status`, used across the codebase
  to mark permanent-vs-transient failures) need a small local type alias per consuming
  file, e.g. `type ClassifiableError = { permanent?: boolean; status?: number }`,
  intersected onto `Error` where a call site needs to set the property:
  `const err: Error & ClassifiableError = new Error(...)`.
- **TS "weak type detection"** rejects assigning a value with zero overlapping property
  names to an all-optional-properties type ("has no properties in common with type X").
  Hits generic constraints like `{ spamInfo?: {...} }` when a test passes a minimal
  object like `{ uid: 1 }`. Fix: give the explicit type argument (or the interface) at
  least one matching property name, even if optional, rather than fighting inference.
- **No single shared "Message" type.** IMAP-fetched messages flow through
  services/steps/controllers with different slices of the same conceptual object read
  in different places (`envelope.from[].address`, `uid`, `headers`, `spamInfo`,
  `aiInfo`, ...). Use small, per-function/module-local structural interfaces (e.g.
  `EnvelopeAddressed`, `HeaderedMessage`, `ScoredMessage`) - duplicated narrow interfaces
  across files, not one shared god-type, and not a new shared module (that would be a
  structural change beyond the agreed literal-port scope).
- **Inline array-literal arguments to generic functions** can make TS infer the type
  parameter from the constraint instead of the literal (usually when the constraint's
  properties are all optional). Assign to an explicitly-typed local `const` first, or
  pass an explicit type argument, when this happens.
- **Genuinely dynamic/defensive functions** (`normalizeEmail`, `isHumanReadable`,
  `parseAiClassificationOutput`, `dateToString`) should take `unknown` plus their
  existing runtime guard, not a strict type that would reject the null/undefined/wrong-
  type inputs their tests (and real callers) intentionally throw at them.
- **`PropertyKey` (e.g. a zod issue's `.path[0]`) interpolated into a template literal**
  needs `String(x)` first - TS flags the possible-symbol-to-string implicit conversion.

## Final steps once every layer is converted

- [x] Update CLAUDE.md's project-structure section to reflect `.ts` extensions in its
  file-naming examples.
- [x] Manual end-to-end smoke test: `bin/local/start.sh .env src/cli/scan-inbox.ts`
  against the real test mailbox configured in `.env` (single-run mode,
  `SCAN_INTERVAL=-1`) - confirm it connects, scans, and exits cleanly. **Do not read/cat
  `.env`** - it holds live API tokens; reference it only by path when invoking the
  script.
  (`scan-inbox.ts` doesn't loop regardless of `SCAN_INTERVAL`, so no override was
  needed. First run surfaced a real pre-existing bug - see the separate fix commit
  above. Second run: exit code 0, no output/errors, ~1.1s total - clean pass,
  consistent with "no new messages to process" at the configured `LOG_LEVEL`.)
- [x] **Commit everything above.** This is the restart point for the JSDoc cleanup pass
  below - if that pass goes wrong or needs a different approach, reset to this commit
  and try again, rather than redoing any conversion work.

## JSDoc cleanup (separate pass, after the commit above)

This runs only after the full conversion is committed. It is a **type-stripping** pass,
not a documentation-stripping pass: the goal is to remove type information that now
lives in TypeScript's own syntax instead of duplicated in a comment, while preserving
every piece of actual prose (what a param means, why a function behaves the way it
does, examples, caveats). Do not delete a JSDoc block wholesale just because it has
`@param`/`@returns` tags - only strip the type annotation portion of each tag line.

- [x] `grep -rn "@param {" src/ test/` (and `@returns {`, `@type {`) to find every JSDoc
  type annotation across the repo. (335 matches across 43 files; no `@type {` hits
  existed. Ran via a small Python script - manual brace-depth matching rather than
  regex, since several types are themselves object/union literals with nested `{}` -
  applied repo-wide in one pass instead of file-by-file.)
- [x] For each match, edit the tag to drop only the `{type}` portion, keeping the name
  and description: e.g. `@param {string} email - the address to normalize` becomes
  `@param email - the address to normalize`, and `@returns {boolean}` (no description)
  is deleted as a line since it carries no remaining content - but `@returns {boolean}
  true if the address is already listed` becomes `@returns true if the address is
  already listed`.
- [x] Leave the rest of every JSDoc block untouched: the summary/description text above
  the tags, `@throws` explanations, and any comment explaining non-obvious *why* stay
  exactly as they are.
- [x] After the pass, re-run `npm test`, `npx tsc --noEmit`, `npm run lint`, and
  `npm run format:check` to confirm nothing broke (this pass is comment-only, but
  Prettier's comment reformatting or a stray syntax slip is worth catching).
  (501/501 tests pass, `tsc --noEmit` and `npm run lint` both clean.
  `format:check` flags 17 files, but all are pre-existing drift unrelated to this
  pass - verified by checking the 3 touched files' committed-HEAD versions against
  Prettier directly, which already failed before this change; the other 14 flagged
  files were never touched by this pass at all.)
- [ ] Commit the cleanup pass as its own commit, separate from the conversion commit.

## Optional: OpenSpec

A prior session captured this as an OpenSpec change (`evaluate-typescript-conversion`,
schema `spec-driven`, `skip_specs: true` since no spec-level behavior changes) but it
was reverted along with everything else. Recreate it if you want the plan tracked there
(`openspec new change evaluate-typescript-conversion`), or just implement directly on
the branch - your call.
