import { z } from 'zod';

/**
 * Body shape for `PUT .../state`: a complete replacement scanner state
 * (design.md D7's restore/backup use case). Mirrors `ScannerState`
 * (`domain/state/state-format.ts`) - `uid_validity` optional, everything
 * else required. `writeScannerState` also calls `validateState` itself, but
 * this schema rejects a malformed body with a 400 before an IMAP connection
 * is ever opened, matching `settings-update.schema.ts`/`list-replace.schema.ts`'s
 * "validate at the API boundary" role for this controller.
 */
export const stateWriteSchema = z
  .object({
    last_uid: z.number().int().nonnegative(),
    last_seen_date: z.string().min(1),
    last_checked: z.string().min(1),
    uid_validity: z.string().min(1).optional(),
  })
  .strict();

export type StateWriteBody = z.infer<typeof stateWriteSchema>;
