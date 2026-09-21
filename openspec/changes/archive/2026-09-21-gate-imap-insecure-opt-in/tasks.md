# Tasks

## 1. Config schema

- [x] 1.1 In `src/lib/core/config.js`, add `IMAP_ALLOW_INSECURE: boolField(false)`
      to `ConfigSchema`, next to `IMAP_TLS`.
- [x] 1.2 Add a `superRefine` check: when `!data.IMAP_TLS && !data.IMAP_ALLOW_INSECURE`,
      add an issue on path `['IMAP_ALLOW_INSECURE']` with a message stating it's
      required alongside `IMAP_TLS=false`.
- [x] 1.3 After successful validation (in `buildAndValidate` or the `config` IIFE),
      log a `warn`-level message when the loaded config has `IMAP_TLS === false`,
      noting IMAP transport encryption's direct-TLS wrapper is disabled.
- [x] 1.4 Add/extend unit tests in `test/unit/core/config.test.js` (or wherever
      `config.js`'s schema is tested - check first) covering: `IMAP_TLS=false` alone
      is rejected naming `IMAP_ALLOW_INSECURE`; `IMAP_TLS=false` +
      `IMAP_ALLOW_INSECURE=true` succeeds; the default (`IMAP_TLS` unset) succeeds
      with no `IMAP_ALLOW_INSECURE` needed.

## 2. IMAP client STARTTLS enforcement

- [x] 2.1 In `src/lib/clients/imap.client.js`'s `newClient()`, set
      `doSTARTTLS: config.IMAP_TLS ? undefined : true` on the `ImapFlow`
      constructor options (never `false`, and never set alongside `secure: true`).
- [x] 2.2 Add/update a unit test asserting `newClient()`'s ImapFlow options include
      `doSTARTTLS: true` when `config.IMAP_TLS` is `false`, and no `doSTARTTLS` key
      (or an `undefined` value) when `config.IMAP_TLS` is `true`.

## 3. Documentation

- [x] 3.1 Add `IMAP_ALLOW_INSECURE` to `.env.example`, next to `IMAP_TLS`, with a
      comment explaining the gate and that STARTTLS is then enforced (connection
      fails rather than falling back to plaintext if the server doesn't support it).
- [x] 3.2 Update `README.md`'s `IMAP_TLS` documentation (the "Required" env vars
      section) to mention `IMAP_ALLOW_INSECURE` and the STARTTLS-enforcement
      behavior.

## 4. Verification

- [x] 4.1 Run `npm test` and confirm all unit tests pass.
- [x] 4.2 Run `npm run lint` and `npm run format:check` and confirm both pass.
