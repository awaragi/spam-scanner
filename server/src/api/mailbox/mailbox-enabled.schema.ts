import { z } from 'zod';

/** Body for `PUT .../enabled` on admin and mailbox routes. */
export const mailboxEnabledSchema = z.object({
  enabled: z.boolean(),
});

export type MailboxEnabledBody = z.infer<typeof mailboxEnabledSchema>;
