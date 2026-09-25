import type { ImapFlow } from 'imapflow';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';
import { MailboxRepository } from '../../infrastructure/mailboxes/mailbox.repository.js';
import {
  newClient,
  safeLogout,
} from '../../infrastructure/imap/imap-connection.factory.js';
import {
  readScannerState,
  deleteScannerState,
} from '../../infrastructure/state/scanner-state.repository.js';
import {
  readMapState,
  writeMapState,
} from '../../infrastructure/state/sender-list.repository.js';
import {
  STATE_KEY_WHITELIST_MAP,
  STATE_KEY_BLACKLIST_MAP,
  type ScannerState,
} from '../../domain/state/state-format.js';

/** Which sender list a `readList`/`replaceList` call targets. */
export type SenderListKind = 'whitelist' | 'blacklist';

function stateKeyForKind(kind: SenderListKind): string {
  return kind === 'whitelist' ? STATE_KEY_WHITELIST_MAP : STATE_KEY_BLACKLIST_MAP;
}

/**
 * State and sender-list operations for one mailbox over a throwaway IMAP
 * connection - `5-server-api-auth` design.md D7. Mirrors
 * `RunnerRegistry.updateSettings`'s own `newClient` → `connect()` → do the
 * work → `safeLogout` in `finally` pattern, but lives in `application/`
 * (not `runtime/`) since it has no runner to stop/replace - it only ever
 * touches state/lists, never a mailbox's running jobs.
 */
@Injectable()
export class MailboxAdminService {
  constructor(
    private readonly mailboxRepository: MailboxRepository,
    private readonly pinoLogger: PinoLogger,
  ) {}

  /**
   * Resolves `mailboxId` against `MailboxRepository.findAll()` (throwing
   * `NotFoundException` when absent - design.md D10, this service owns the
   * mailbox lookup so it throws the HTTP-mappable exception directly rather
   * than the registry's plain `Error('Unknown mailbox: ...')`), then runs
   * `fn` against a connected IMAP client, closing it in `finally` even when
   * `fn` throws.
   */
  private async withConnection<T>(
    mailboxId: string,
    fn: (imap: ImapFlow, mailbox: Mailbox) => Promise<T>,
  ): Promise<T> {
    const mailbox = this.mailboxRepository
      .findAll()
      .find((candidate) => candidate.id === mailboxId);
    if (!mailbox) {
      throw new NotFoundException(`Unknown mailbox: ${mailboxId}`);
    }

    const imap = newClient(mailbox, this.pinoLogger.logger);
    try {
      await imap.connect();
      return await fn(imap, mailbox);
    } finally {
      await safeLogout(imap, this.pinoLogger.logger);
    }
  }

  /**
   * Reads the mailbox's scanner state, or `null` when none exists. Calls
   * `readScannerState` without a default so a missing state message throws
   * ("Scanner state not found") rather than being silently defaulted -
   * that throw is caught here and translated to `null` instead of
   * propagating as an unhandled 500.
   */
  async readState(mailboxId: string): Promise<ScannerState | null> {
    return this.withConnection(mailboxId, async (imap, mailbox) => {
      try {
        return await readScannerState(imap, mailbox.stateFolder);
      } catch (error) {
        if (error instanceof Error && error.message === 'Scanner state not found') {
          return null;
        }
        throw error;
      }
    });
  }

  /** Deletes the mailbox's stored scanner state. */
  async resetState(mailboxId: string): Promise<boolean> {
    return this.withConnection(mailboxId, (imap, mailbox) =>
      deleteScannerState(imap, mailbox.stateFolder, this.pinoLogger.logger),
    );
  }

  /** Reads the mailbox's whitelist or blacklist. */
  async readList(mailboxId: string, kind: SenderListKind): Promise<string[]> {
    return this.withConnection(mailboxId, (imap, mailbox) =>
      readMapState(
        imap,
        mailbox.stateFolder,
        stateKeyForKind(kind),
        this.pinoLogger.logger,
      ),
    );
  }

  /** Replaces the mailbox's whitelist or blacklist with `addresses`. */
  async replaceList(
    mailboxId: string,
    kind: SenderListKind,
    addresses: string[],
  ): Promise<void> {
    await this.withConnection(mailboxId, (imap, mailbox) =>
      writeMapState(
        imap,
        mailbox.stateFolder,
        stateKeyForKind(kind),
        addresses,
        this.pinoLogger.logger,
      ),
    );
  }
}
