import type { AccountRecord } from '../../infrastructure/accounts/account-record.js';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';

/** `AccountRecord` with the password omitted - never returned to a caller. */
export type PublicAccountRecord = Omit<AccountRecord, 'imapPassword'>;

/** `GET /admin/accounts`'s body shape. */
export interface AccountListing {
  version: number;
  accounts: PublicAccountRecord[];
}

/** Body for creating an account - every field required, including the password. */
export interface CreateAccountInput {
  id: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string;
  imapTls: boolean;
  imapAllowInsecure: boolean;
  stateFolder: string;
  enabled: boolean;
  aiEnabled: boolean;
}

/**
 * Body for updating an account - every field optional. An omitted
 * `imapPassword` means "keep the currently stored password" (design.md
 * D6's "Password rules... optional on PATCH (omit = unchanged)"). `id` is
 * intentionally not here at all - immutable, per `server/mailbox-registry`.
 */
export type UpdateAccountInput = Partial<Omit<CreateAccountInput, 'id'>>;

export function toPublicRecord(account: AccountRecord): PublicAccountRecord {
  const { imapPassword: _imapPassword, ...rest } = account;
  return rest;
}

/**
 * `AccountRecord` and `Mailbox` are field-for-field identical shapes
 * (`Mailbox` was extended with `aiEnabled` for exactly this reason - see
 * `persistent-mailbox-accounts` design.md D5) - this is a type-level
 * relabeling, not a real transform.
 */
export function toMailbox(account: AccountRecord): Mailbox {
  return { ...account };
}

export function toListing(file: {
  version: number;
  accounts: readonly AccountRecord[];
}): AccountListing {
  return {
    version: file.version,
    accounts: file.accounts.map(toPublicRecord),
  };
}
