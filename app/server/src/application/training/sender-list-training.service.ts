import { Injectable } from '@nestjs/common';
import type { MailboxSession } from '../mailbox-session.js';
import { ScanConfig } from '../../config/app-config.js';
import {
  STATE_KEY_WHITELIST_MAP,
  STATE_KEY_BLACKLIST_MAP,
} from '../../domain/state/state-format.js';
import { extractSenderAddresses } from '../../domain/sender-lists/sender-lists.js';
import {
  open,
  count,
  search,
  fetchMessageHeadersByUIDs,
  moveMessages,
} from '../../infrastructure/imap/mailbox.gateway.js';
import { readMapState } from '../../infrastructure/state/sender-list.repository.js';
import { updateListState } from './list-update.step.js';

/**
 * Trains a mailbox's IMAP-backed whitelist/blacklist from its
 * `train.whitelist`/`train.blacklist` folders, ported from terminal's
 * `sender-list-training.controller.ts` (workflow) plus its
 * `list-update.step.ts` (kept as a co-located step, see
 * `list-update.step.ts`).
 *
 * Unlike `RspamdTrainingService`, this workflow's own failures are NOT
 * swallowed - an error opening/reading the training folder, or updating list
 * state, is logged at `error` and rethrown, exactly as terminal's
 * `sender-list-training.controller.ts` does today.
 */
@Injectable()
export class SenderListTrainingService {
  constructor(private readonly scanConfig: ScanConfig) {}

  /**
   * Generic map training workflow handler
   * @param session - The mailbox session to train
   * @param folder - Training folder path
   * @param mapStateKey - State key identifying the mailbox's IMAP-backed
   *   whitelist/blacklist (`STATE_KEY_WHITELIST_MAP`/`STATE_KEY_BLACKLIST_MAP`)
   * @param destFolder - Destination folder after processing
   * @param type - Map type ('whitelist' or 'blacklist')
   */
  private async runMapTraining(
    session: MailboxSession,
    folder: string,
    mapStateKey: string,
    destFolder: string,
    type: string
  ): Promise<void> {
    const { imap, logger, folders } = session;
    try {
      const box = await open(imap, folder, false, logger);
      const messageCount = count(box);

      if (messageCount === 0) {
        logger.debug({ folder, type }, 'No messages in training folder');
        return;
      }

      const uids = await search(imap, { all: true }, logger);
      const { batchProcessSize } = this.scanConfig;

      // Read the list once up front so extraction can skip a sender already
      // covered by an exact-address or domain entry (see `isSenderListed`) -
      // e.g. training shouldn't re-add "bob@example.com" as its own entry
      // when "@example.com" is already listed. Updated as batches add new
      // entries so a later batch in the same run also sees them.
      const listedEntries = new Set(
        await readMapState(imap, folders.state, mapStateKey, logger)
      );

      // Search UIDs once, then fetch/extract/move batchProcessSize messages
      // at a time - bounds how much message content is ever in memory at
      // once, fetches headers only (never the full source/body map training
      // doesn't need), and means a batch already extracted and moved
      // survives a later batch's fetch failure (see
      // `bounded-training-fetch`). Each batch's list-state update appends
      // independently - append mode merges with whatever's already stored,
      // so per-batch calls compose correctly into the same end state as a
      // single call over every sender would.
      for (let i = 0; i < uids.length; i += batchProcessSize) {
        const batchUids = uids.slice(i, i + batchProcessSize);
        const batchMessages = await fetchMessageHeadersByUIDs(imap, batchUids, logger);
        const senders = extractSenderAddresses(batchMessages, listedEntries);

        if (senders.length === 0) {
          logger.info(
            { folder, type, total: batchMessages.length },
            `No extractable senders found among ${type} training messages; moving them on unlearned`
          );
        } else {
          // Training always appends - it merges newly extracted senders
          // with whatever's already in the mailbox's IMAP-backed list,
          // never replaces it.
          const result = await updateListState(
            imap,
            folders.state,
            mapStateKey,
            senders,
            'append',
            logger
          );
          logger.info({ folder, type, ...result }, `${type} list updated`);
          senders.forEach(sender => listedEntries.add(sender));
        }

        // Move processed messages to destination folder
        await moveMessages(imap, batchMessages, destFolder, logger);
        logger.debug(
          { folder, type, destFolder, total: batchMessages.length },
          'Training messages moved'
        );
      }
    } catch (error) {
      logger.error(
        {
          folder,
          type,
          error: error instanceof Error ? error.message : String(error),
        },
        `Error in ${type} workflow`
      );
      throw error;
    }
  }

  /**
   * Run whitelist training workflow: extracts senders and updates the
   * mailbox's IMAP-backed whitelist.
   * @param session - The mailbox session to train
   */
  async runWhitelist(session: MailboxSession): Promise<void> {
    await this.runMapTraining(
      session,
      session.folders.trainWhitelist,
      STATE_KEY_WHITELIST_MAP,
      session.folders.inbox,
      'whitelist'
    );
  }

  /**
   * Run blacklist training workflow: extracts senders and updates the
   * mailbox's IMAP-backed blacklist.
   * @param session - The mailbox session to train
   */
  async runBlacklist(session: MailboxSession): Promise<void> {
    await this.runMapTraining(
      session,
      session.folders.trainBlacklist,
      STATE_KEY_BLACKLIST_MAP,
      session.folders.spam,
      'blacklist'
    );
  }
}
