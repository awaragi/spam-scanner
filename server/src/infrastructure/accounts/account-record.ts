import type { z } from 'zod';
import { accountRecordSchema } from './account.schema.js';

/**
 * One mailbox account record, durably stored by `AccountStore` - the
 * `server/mailbox-accounts` spec's "Account records are stored in a
 * versioned JSON file under SPAM_SCANNER_DATA" requirement. Derived from
 * `accountRecordSchema` (`account.schema.ts`), the single canonical source
 * for this shape - see that schema's own doc comment for per-field notes.
 */
export type AccountRecord = z.infer<typeof accountRecordSchema>;
