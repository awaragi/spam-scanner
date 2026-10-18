import { z } from 'zod';

/**
 * The on-disk shape of one account record - the single canonical source for
 * this 9-field shape. `AccountRecord` (`account-record.ts`) and `Mailbox`
 * (`../mailboxes/mailbox.ts`) are both `z.infer<typeof accountRecordSchema>`
 * rather than hand-declared duplicates, so a field can no longer drift out
 * of sync between the three. Used both to validate the accounts file on
 * load (`JsonFileAccountStore.load`) and, per task 7.2, to validate a
 * hand-authored `accounts.json` example in a small test.
 */
export const accountRecordSchema = z.object({
  /**
   * The mailbox owner's email address (immutable - see the
   * `server/mailbox-registry` spec), distinct from `imapUser`, which may be
   * a bare username on some providers. Also this mailbox's rspamd user
   * (`rspamdUserFor()` in `mailbox.ts`) - there is deliberately no separate
   * stored field for that.
   */
  id: z.email(),
  imapHost: z.string().min(1),
  imapPort: z.number().int(),
  imapUser: z.string().min(1),
  /** Stored in plain text - see design.md's "Risks/Trade-offs" (encryption at rest is explicitly deferred). */
  imapPassword: z.string(),
  imapTls: z.boolean(),
  imapAllowInsecure: z.boolean(),
  stateFolder: z.string().min(1),
  enabled: z.boolean(),
  /**
   * Admin-only per-mailbox AI opt-out - see `server/mailbox-settings`. Not
   * settable through a mailbox's own settings message/API.
   */
  aiEnabled: z.boolean(),
});

/**
 * The whole accounts file: a monotonic `version` plus the `accounts` array -
 * the `server/mailbox-accounts` spec's "a monotonic integer `version` and an
 * `accounts` array" requirement.
 */
export const accountsFileSchema = z.object({
  version: z.number().int().nonnegative(),
  accounts: z.array(accountRecordSchema),
});
