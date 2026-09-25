import { z } from 'zod';

/**
 * Body shape for `PUT .../lists/:kind` and `POST .../lists/:kind/import`
 * (design.md D5, D7): a validated array of non-empty address strings.
 * `sender-lists` (`domain/sender-lists/sender-lists.ts`) has no zod schema
 * of its own to reuse - it normalizes/validates addresses imperatively
 * (`normalizeEmail`) further down the stack (`MailboxAdminService.
 * replaceList` → `writeMapState`) - so this is shape validation only:
 * reject anything that isn't an array of non-empty strings before it
 * reaches the service.
 */
export const listReplaceSchema = z.array(z.string().min(1));

export type ListReplaceBody = z.infer<typeof listReplaceSchema>;
