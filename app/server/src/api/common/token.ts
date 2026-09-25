/**
 * The two JWT payload shapes signed/verified across `api/` (see design.md
 * D2). `scope` is what the guards (`AdminGuard`/`MailboxScopeGuard`) branch
 * on; `mailboxId` is carried explicitly on the mailbox token (not only as
 * `sub`) so the mailbox-scope guard reads one obvious field rather than
 * re-deriving it from `sub`.
 */
export interface AdminTokenPayload {
  sub: 'admin';
  scope: 'admin';
}

export interface MailboxTokenPayload {
  sub: string;
  scope: 'mailbox';
  mailboxId: string;
}

/** The decoded shape of any token this server signs, before a guard narrows it by `scope`. */
export type TokenPayload = AdminTokenPayload | MailboxTokenPayload;

/** Narrows a decoded `TokenPayload` to `MailboxTokenPayload` by its `scope` claim. */
export function isMailboxTokenPayload(
  payload: TokenPayload
): payload is MailboxTokenPayload {
  return payload.scope === 'mailbox';
}

/** Narrows a decoded `TokenPayload` to `AdminTokenPayload` by its `scope` claim. */
export function isAdminTokenPayload(
  payload: TokenPayload
): payload is AdminTokenPayload {
  return payload.scope === 'admin';
}
