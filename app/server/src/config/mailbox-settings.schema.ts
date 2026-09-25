/**
 * The overridable subset of `MailboxSettings` a mailbox's settings message
 * may set - see the `mailbox-settings` spec's "Only a fixed set of keys are
 * overridable per mailbox" requirement and design.md D2. Field names/types
 * mirror `mailbox-settings.defaults.ts`'s `MailboxFolderSettings`/
 * `MailboxLabelSettings`/`MailboxThresholdSettings`/
 * `MailboxAiEscalationSettings`/`MailboxSettings` interfaces exactly - keep
 * both in sync by hand.
 *
 * Unlike `app-config.schema.ts` (which parses raw environment *strings*),
 * a settings message already contains real JSON values written by the
 * server's own update operation, so there is no `intField`/`boolField`
 * string-preprocessing here.
 */
import { z } from 'zod';
import type { Logger as PinoLogger } from 'pino';

const foldersSchema = z
  .object({
    inbox: z.string(),
    spam: z.string(),
    spamLow: z.string(),
    spamHigh: z.string(),
    trainSpam: z.string(),
    trainHam: z.string(),
    trainWhitelist: z.string(),
    trainBlacklist: z.string(),
  })
  .partial();

const labelsSchema = z
  .object({
    spamLow: z.string(),
    spamHigh: z.string(),
  })
  .partial();

const thresholdsSchema = z
  .object({
    clean: z.number(),
    low: z.number(),
    confirmed: z.number(),
  })
  .partial();

const aiEscalationSchema = z
  .object({
    toLowThreshold: z.number(),
    toHighThreshold: z.number(),
  })
  .partial();

/**
 * The fixed overridable-key set (design.md D2's sketch). Every top-level key
 * is optional (a settings message may override just one thing), and the four
 * nested groups are themselves partial, so a message can override e.g. just
 * `thresholds.clean` without repeating `low`/`confirmed`.
 */
export const overridableSchema = z
  .object({
    folders: foldersSchema,
    scanRead: z.boolean(),
    scanInitialState: z.enum(['new', 'all']),
    processingMode: z.enum(['label', 'folder']),
    labels: labelsSchema,
    thresholds: thresholdsSchema,
    aiEscalation: aiEscalationSchema,
    aiEnabled: z.boolean(),
  })
  .partial();

/**
 * `z.infer` here (unlike `AppConfigSchema` in `app-config.schema.ts`) does
 * not hit that file's TS2589 "type instantiation is excessively deep" issue
 * - this schema is a plain, statically-declared object (no
 * `configGroups.reduce`/`.merge()` chain collapsing inference), so `z.infer`
 * stays a precise, single source of truth. Verified against `nest build`.
 */
export type OverridableSettings = z.infer<typeof overridableSchema>;

/** The nested group schemas, keyed by their field name on `overridableSchema`. */
const nestedGroupSchemas = {
  folders: foldersSchema,
  labels: labelsSchema,
  thresholds: thresholdsSchema,
  aiEscalation: aiEscalationSchema,
} as const;

/**
 * A structural mirror of `overridableSchema` where every level -
 * top-level and each of the four nested groups - is `.passthrough()`
 * rather than stripping, so parsing it reveals every key a settings message
 * actually contained (recognized or not) without throwing on the
 * unrecognized ones. A *type* error on a recognized key still throws here,
 * exactly as it does against the real `overridableSchema` - `.passthrough()`
 * only relaxes unknown-key handling, not the declared fields' own types.
 */
const passthroughSchema = z
  .object({
    folders: foldersSchema.passthrough(),
    scanRead: z.boolean(),
    scanInitialState: z.enum(['new', 'all']),
    processingMode: z.enum(['label', 'folder']),
    labels: labelsSchema.passthrough(),
    thresholds: thresholdsSchema.passthrough(),
    aiEscalation: aiEscalationSchema.passthrough(),
    aiEnabled: z.boolean(),
  })
  .partial()
  .passthrough();

/** Drops and warns on any key in `keys` not present in `recognized`, in place. */
function dropUnrecognized(
  container: Record<string, unknown>,
  recognized: ReadonlySet<string>,
  describeKey: (key: string) => string,
  logger?: PinoLogger,
  mailboxId?: string
): void {
  for (const key of Object.keys(container)) {
    if (!recognized.has(key)) {
      logger?.warn(
        { mailboxId, key: describeKey(key) },
        'Ignoring unrecognized or global-only settings key'
      );
      delete container[key];
    }
  }
}

/**
 * Validates a mailbox's raw stored (or proposed) settings overrides against
 * the fixed overridable-key set, per design.md D2:
 *
 * - `raw === undefined` (no settings message) passes through as `undefined`,
 *   no parsing, no logging.
 * - An unrecognized or global-only key (top-level, e.g. a stray
 *   `scanInterval`, or nested, e.g. an unknown `thresholds.*` field) is
 *   logged as a warning and dropped, without preventing any other valid
 *   override in the same message from applying.
 * - A *recognized* key with the wrong type (e.g. `thresholds.clean:
 *   "thirty"`) throws a `ZodError` - observably different from the
 *   unrecognized-key case, which never throws. This is what the write path
 *   (a later change) relies on to reject an invalid update outright.
 */
export function validateOverrides(
  raw: Record<string, unknown> | undefined,
  logger?: PinoLogger,
  mailboxId?: string
): OverridableSettings | undefined {
  if (raw === undefined) {
    return undefined;
  }

  // Throws (ZodError) on a type error against any recognized field, at any
  // level - unknown keys, at any level, are allowed through unvalidated.
  const withEveryKey = passthroughSchema.parse(raw) as Record<
    string,
    unknown
  >;

  dropUnrecognized(
    withEveryKey,
    new Set(Object.keys(overridableSchema.shape)),
    key => key,
    logger,
    mailboxId
  );

  for (const [groupKey, groupSchema] of Object.entries(nestedGroupSchemas)) {
    const group = withEveryKey[groupKey];
    if (group && typeof group === 'object' && !Array.isArray(group)) {
      dropUnrecognized(
        group as Record<string, unknown>,
        new Set(Object.keys(groupSchema.shape)),
        key => `${groupKey}.${key}`,
        logger,
        mailboxId
      );
    }
  }

  // Re-parse the now recognized-key-only subset through the real (stripping)
  // schema for the final, validated result.
  return overridableSchema.parse(withEveryKey);
}
