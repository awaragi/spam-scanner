import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { AccountRecord } from '../../infrastructure/accounts/account-record.js';
import {
  AccountStore,
  VersionConflict,
} from '../../infrastructure/accounts/account-store.js';
import { testImapConnection } from '../../infrastructure/accounts/imap-connection-test.js';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';
import {
  toListing,
  toMailbox,
  type AccountListing,
  type CreateAccountInput,
  type UpdateAccountInput,
} from './account-admin.dto.js';

/** The result of a mutation that changes the live registry's membership. */
export interface AccountMutationResult {
  listing: AccountListing;
  mailbox: Mailbox;
}

/**
 * The account mutation pipeline from `persistent-mailbox-accounts`
 * design.md D4: duplicate-id check (create only) → build the effective
 * record → `testImapConnection` → `AccountStore.save` (optimistic locking) →
 * caller syncs the live `RunnerRegistry`.
 *
 * Deliberately does NOT depend on `RunnerRegistry` itself - `runtime/` sits
 * above `application/` in this codebase's dependency direction (see
 * `.dependency-cruiser.cjs`), so the "RunnerRegistry sync" half of D4's
 * step 6 is the caller's job (`AccountsController`/`AdminController`/
 * `MailboxController`, all in `api/`, which may depend on both
 * `application/` and `runtime/`): call this service first, then feed its
 * returned `Mailbox` into the matching `RunnerRegistry` method.
 *
 * No IMAP test (and no `RunnerRegistry` involvement at all) for `delete` -
 * the `server/mailbox-accounts` spec's own "Delete does not require IMAP
 * test" requirement; its caller still calls `RunnerRegistry.removeAccount`
 * after a successful `delete()`.
 */
@Injectable()
export class AccountAdminService {
  constructor(
    private readonly accountStore: AccountStore,
    private readonly pinoLogger: PinoLogger,
  ) {}

  async list(): Promise<AccountListing> {
    return toListing(await this.accountStore.load());
  }

  /** The one account's current `enabled` state and the file's version - for the enable/disable UI's own `If-Match` precondition. */
  async getEnabledState(
    mailboxId: string,
  ): Promise<{ enabled: boolean; version: number }> {
    const { version, accounts } = await this.accountStore.load();
    const account = this.requireAccount(accounts, mailboxId);
    return { enabled: account.enabled, version };
  }

  async create(
    input: CreateAccountInput,
    expectedVersion: number,
  ): Promise<AccountMutationResult> {
    const { accounts } = await this.accountStore.load();

    // Step 2 (D4): duplicate id rejected before the IMAP test ever runs.
    if (accounts.some((account) => account.id === input.id)) {
      throw new ConflictException(`Account already exists: ${input.id}`);
    }

    const record: AccountRecord = { ...input };
    this.assertTlsInvariant(record);

    // Step 4: no file write happens unless this succeeds.
    await testImapConnection(record, this.pinoLogger.logger);

    const saved = await this.saveOrConflict(expectedVersion, [
      ...accounts,
      record,
    ]);

    return { listing: toListing(saved), mailbox: toMailbox(record) };
  }

  async update(
    mailboxId: string,
    patch: UpdateAccountInput,
    expectedVersion: number,
  ): Promise<AccountMutationResult> {
    const { accounts } = await this.accountStore.load();
    const existing = this.requireAccount(accounts, mailboxId);

    // Step 3 (D4): merge; an omitted password keeps the stored one.
    const effective: AccountRecord = {
      ...existing,
      ...patch,
      id: existing.id,
      imapPassword: patch.imapPassword ?? existing.imapPassword,
    };
    this.assertTlsInvariant(effective);

    await testImapConnection(effective, this.pinoLogger.logger);

    const saved = await this.saveOrConflict(
      expectedVersion,
      accounts.map((account) =>
        account.id === mailboxId ? effective : account,
      ),
    );

    return { listing: toListing(saved), mailbox: toMailbox(effective) };
  }

  /**
   * Shared by the admin and mailbox-owner `PUT .../enabled` routes
   * (`server/mailbox-api`'s "An admin can enable or disable any managed
   * mailbox's runner with persistence" / "A mailbox token holder can
   * enable or disable only its own mailbox's runner with persistence"
   * requirements) - scope enforcement (which mailbox a mailbox token may
   * target) is the caller's guard, not this method's concern.
   */
  async setEnabled(
    mailboxId: string,
    enabled: boolean,
    expectedVersion: number,
  ): Promise<AccountMutationResult> {
    const { accounts } = await this.accountStore.load();
    const existing = this.requireAccount(accounts, mailboxId);
    const effective: AccountRecord = { ...existing, enabled };

    await testImapConnection(effective, this.pinoLogger.logger);

    const saved = await this.saveOrConflict(
      expectedVersion,
      accounts.map((account) =>
        account.id === mailboxId ? effective : account,
      ),
    );

    return { listing: toListing(saved), mailbox: toMailbox(effective) };
  }

  /** No IMAP test - see this class's own doc comment. */
  async delete(
    mailboxId: string,
    expectedVersion: number,
  ): Promise<AccountListing> {
    const { accounts } = await this.accountStore.load();
    this.requireAccount(accounts, mailboxId);

    const saved = await this.saveOrConflict(
      expectedVersion,
      accounts.filter((account) => account.id !== mailboxId),
    );

    return toListing(saved);
  }

  /**
   * The `imap-transport-security` capability's invariant, re-checked here
   * (the old env-only `MailboxesSchema` enforced the same rule at startup
   * - now that connections are mutable at runtime, this is the equivalent
   * guard): disabling direct TLS without the explicit `imapAllowInsecure`
   * opt-in is rejected outright, before any IMAP connection is attempted.
   */
  private assertTlsInvariant(record: AccountRecord): void {
    if (!record.imapTls && !record.imapAllowInsecure) {
      throw new BadRequestException(
        'imapAllowInsecure must be true when imapTls is false - disabling IMAP transport encryption must be an explicit, deliberate choice',
      );
    }
  }

  private requireAccount(
    accounts: readonly AccountRecord[],
    mailboxId: string,
  ): AccountRecord {
    const account = accounts.find((candidate) => candidate.id === mailboxId);
    if (!account) {
      throw new NotFoundException(`Unknown mailbox: ${mailboxId}`);
    }
    return account;
  }

  /**
   * `AccountStore.save`'s own `VersionConflict` is a plain `Error`, not an
   * HTTP-mappable exception (same reasoning as `RunnerRegistry`'s "Unknown
   * mailbox" errors) - translated to `ConflictException` here, at the one
   * place every mutation's save goes through.
   */
  private async saveOrConflict(
    expectedVersion: number,
    accounts: readonly AccountRecord[],
  ) {
    try {
      return await this.accountStore.save(expectedVersion, accounts);
    } catch (error) {
      if (error instanceof VersionConflict) {
        throw new ConflictException({
          message: error.message,
          currentVersion: error.currentVersion,
        });
      }
      throw error;
    }
  }
}
