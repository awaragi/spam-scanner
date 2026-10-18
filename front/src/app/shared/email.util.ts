/** A deliberately loose "looks like an email" check - used only to decide
 * whether a typed IMAP username can double as the mailbox id (which the
 * server requires to be a real email - `accountRecordSchema.id` is
 * `z.email()`), not to validate the email itself. The server is the
 * authority on what counts as a valid email; this just decides which form
 * field the UI should submit as the id. */
export function isEmailShaped(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}
