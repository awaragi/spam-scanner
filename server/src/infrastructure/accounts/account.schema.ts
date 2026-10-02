import { z } from 'zod';

/**
 * The on-disk shape of one account record - mirrors `AccountRecord`
 * (`account-record.ts`) field-for-field. Used both to validate the accounts
 * file on load (`JsonFileAccountStore.load`) and, per task 7.2, to validate
 * a hand-authored `accounts.json` example in a small test.
 */
export const accountRecordSchema = z.object({
  id: z.email(),
  imapHost: z.string().min(1),
  imapPort: z.number().int(),
  imapUser: z.string().min(1),
  imapPassword: z.string(),
  imapTls: z.boolean(),
  imapAllowInsecure: z.boolean(),
  stateFolder: z.string().min(1),
  enabled: z.boolean(),
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

export type AccountRecordInput = z.infer<typeof accountRecordSchema>;
export type AccountsFileInput = z.infer<typeof accountsFileSchema>;
