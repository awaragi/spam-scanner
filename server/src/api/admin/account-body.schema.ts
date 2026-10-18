import { z } from 'zod';

/**
 * Body for `POST /admin/accounts` - every connection field required
 * (design.md D6's "Password rules: required on POST"), `id` immutable for
 * the life of the record (`server/mailbox-registry`). Field defaults mirror
 * the old `MAILBOX_<n>_*` env defaults, so an operator used to those keys
 * sees the same behavior when a field is omitted.
 */
export const createAccountSchema = z.object({
  id: z.email(),
  imapHost: z.string().min(1),
  imapPort: z.number().int().positive().default(993),
  imapUser: z.string().min(1),
  imapPassword: z.string().min(1),
  imapTls: z.boolean().default(true),
  imapAllowInsecure: z.boolean().default(false),
  stateFolder: z.string().min(1).default('INBOX.scanner.state'),
  enabled: z.boolean().default(true),
  aiEnabled: z.boolean().default(true),
});

export type CreateAccountBody = z.infer<typeof createAccountSchema>;

/**
 * Body for `PATCH /admin/accounts/:id` - every field optional, no default
 * (design.md D6's "optional on PATCH (omit = unchanged)" - a field omitted
 * here must stay whatever the stored record already has, not fall back to
 * `createAccountSchema`'s create-time default). `id` is deliberately not a
 * field at all - immutable, changed only by delete + re-create.
 */
export const updateAccountSchema = z.object({
  imapHost: z.string().min(1).optional(),
  imapPort: z.number().int().positive().optional(),
  imapUser: z.string().min(1).optional(),
  imapPassword: z.string().min(1).optional(),
  imapTls: z.boolean().optional(),
  imapAllowInsecure: z.boolean().optional(),
  stateFolder: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  aiEnabled: z.boolean().optional(),
});

export type UpdateAccountBody = z.infer<typeof updateAccountSchema>;
