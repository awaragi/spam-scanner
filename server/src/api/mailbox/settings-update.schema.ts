import type { z } from 'zod';
import { overridableSchema } from '../../config/mailbox-settings.schema.js';

/**
 * Body shape for `PUT mailboxes/:mailboxId/settings` (design.md D5, D6):
 * reuses `overridableSchema` directly. This is shape validation only - the
 * pipe rejects a malformed body before `RunnerRegistry.updateSettings` ever
 * runs; the authoritative validation (including unknown-key warnings) stays
 * in `validateOverrides`, unchanged, once the request reaches the service.
 *
 * `aiEnabled` gets an explicit rejection here, distinct from how an
 * ordinary unrecognized key is handled: `overridableSchema` no longer
 * declares `aiEnabled` at all (`persistent-mailbox-accounts` design.md D5 -
 * it is admin-only, set via the account API), so without this check it
 * would just be silently stripped like any other unknown key before
 * `validateOverrides` ever sees it. The `server/mailbox-api` spec's
 * "Settings update rejects aiEnabled" scenario requires an outright 400
 * instead - stricter than the "warn and ignore" treatment a *stored*
 * settings message gets from `validateOverrides`.
 */
export const settingsUpdateSchema = overridableSchema
  .passthrough()
  .refine((value) => !('aiEnabled' in value), {
    message:
      'aiEnabled cannot be set through mailbox settings - it is admin-only, set via the account API (POST/PATCH /admin/accounts)',
    path: ['aiEnabled'],
  })
  .transform((value) => overridableSchema.parse(value));

export type SettingsUpdateBody = z.infer<typeof overridableSchema>;
