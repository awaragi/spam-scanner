import type { AccountRecord } from './account-record.js';

/** The accounts file's whole content - a monotonic version plus every account. */
export interface AccountsFile {
  readonly version: number;
  readonly accounts: readonly AccountRecord[];
}

/**
 * Thrown by `AccountStore.save` when `expectedVersion` no longer matches the
 * file's current version - the `server/mailbox-accounts` spec's "Optimistic
 * locking uses If-Match against the file version" requirement. Carries the
 * current version so a caller (`AccountAdminService`) can report it back to
 * the client without a second `load()` call.
 */
export class VersionConflict extends Error {
  constructor(readonly currentVersion: number) {
    super(
      `Account store version conflict: expected version does not match current version ${currentVersion}`,
    );
    this.name = 'VersionConflict';
  }
}

/**
 * The narrow port every account mutation and the mailbox registry read
 * through (`server/mailbox-accounts` spec's "The account store is
 * replaceable behind a narrow port" requirement) - application and API
 * layers depend on this abstraction, never on `JsonFileAccountStore`'s file
 * format directly. An abstract class, not an `interface`, so it doubles as
 * a Nest DI token (`AccountsModule` binds it to `JsonFileAccountStore`
 * today; swapping storage later is a new `@Injectable()` plus a changed
 * module binding, with every caller unaffected).
 */
export abstract class AccountStore {
  /**
   * Returns the current accounts file, or `{ version: 0, accounts: [] }`
   * when none has ever been written yet.
   */
  abstract load(): Promise<AccountsFile>;

  /**
   * Replaces the whole `accounts` array and increments the file's version
   * by exactly one, iff `expectedVersion` still matches the current
   * version. Throws `VersionConflict` (and leaves the file unchanged)
   * otherwise.
   */
  abstract save(
    expectedVersion: number,
    accounts: readonly AccountRecord[],
  ): Promise<AccountsFile>;
}
