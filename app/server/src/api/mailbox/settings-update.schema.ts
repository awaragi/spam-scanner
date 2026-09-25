import type { z } from 'zod';
import { overridableSchema } from '../../config/mailbox-settings.schema.js';

/**
 * Body shape for `PUT mailboxes/:mailboxId/settings` (design.md D5, D6):
 * reuses `overridableSchema` directly. This is shape validation only - the
 * pipe rejects a malformed body before `RunnerRegistry.updateSettings` ever
 * runs; the authoritative validation (including unknown-key warnings) stays
 * in `validateOverrides`, unchanged, once the request reaches the service.
 */
export const settingsUpdateSchema = overridableSchema;

export type SettingsUpdateBody = z.infer<typeof settingsUpdateSchema>;
