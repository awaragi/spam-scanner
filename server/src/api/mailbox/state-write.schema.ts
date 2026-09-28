import type { z } from 'zod';
import { scannerStateSchema } from 'shared/state';

/**
 * Body shape for `PUT .../state`: a complete replacement scanner state
 * (a restore/backup use case - not covered by `5-server-api-auth`
 * design.md's D7, which only designed read/reset for scanner state; this
 * route extends that same throwaway-connection pattern to a full write, with
 * no design record of its own). Reuses `scannerStateSchema` directly (same
 * pattern as `settings-update.schema.ts`/`overridableSchema`) rather than
 * an independently-declared schema, so the API boundary and
 * `writeScannerState`'s own `validateState` call can never drift on what a
 * valid scanner state looks like. This schema rejects a malformed body with
 * a 400 before an IMAP connection is ever opened; `validateState` is what
 * actually enforces it once the request reaches the service.
 */
export const stateWriteSchema = scannerStateSchema;

export type StateWriteBody = z.infer<typeof stateWriteSchema>;
