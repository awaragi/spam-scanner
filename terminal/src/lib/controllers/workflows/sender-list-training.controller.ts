import type { ImapFlow } from 'imapflow';
import { rootLogger } from '../../core/logger.ts';
import {
  open,
  count,
  search,
  fetchMessageHeadersByUIDs,
  moveMessages,
} from '../../clients/imap.client.ts';
import { extractSenderAddresses } from '../../services/sender-lists.service.ts';
import { readMapState } from '../../clients/state-manager.client.ts';
import { updateListState } from '../steps/list-update.step.ts';
import { createDefaultContext, type Context } from '../../core/context.ts';

const logger = rootLogger.forComponent('sender-list-training-controller');

/**
 * Generic map training workflow handler
 * @param imap - ImapFlow client
 * @param folder - Training folder path
 * @param mapStateKey - State key identifying the mailbox's IMAP-backed whitelist/blacklist (see config.js STATE_KEY_WHITELIST_MAP/STATE_KEY_BLACKLIST_MAP)
 * @param destFolder - Destination folder after processing
 * @param type - Map type ('whitelist' or 'blacklist')
 * @param ctx
 */
async function runMapTraining(
  imap: ImapFlow,
  folder: string,
  mapStateKey: string,
  destFolder: string,
  type: string,
  ctx: Context
): Promise<void> {
  try {
    const box = await open(imap, folder);
    const messageCount = count(box);

    if (messageCount === 0) {
      logger.debug({ folder, type }, 'No messages in training folder');
      return;
    }

    const uids = await search(imap, { all: true });
    const { BATCH_PROCESS_SIZE } = ctx.config;

    // Read the list once up front so extraction can skip a sender already
    // covered by an exact-address or domain entry (see `isSenderListed`) -
    // e.g. training shouldn't re-add "bob@example.com" as its own entry when
    // "@example.com" is already listed. Updated as batches add new entries so
    // a later batch in the same run also sees them.
    const listedEntries = new Set(await readMapState(imap, mapStateKey));

    // Search UIDs once, then fetch/extract/move BATCH_PROCESS_SIZE messages
    // at a time - bounds how much message content is ever in memory at once,
    // fetches headers only (never the full source/body map training doesn't
    // need), and means a batch already extracted and moved survives a later
    // batch's fetch failure (see `bounded-training-fetch`). Each batch's
    // list-state update appends independently - append mode merges with
    // whatever's already stored, so per-batch calls compose correctly into
    // the same end state as a single call over every sender would.
    for (let i = 0; i < uids.length; i += BATCH_PROCESS_SIZE) {
      const batchUids = uids.slice(i, i + BATCH_PROCESS_SIZE);
      const batchMessages = await fetchMessageHeadersByUIDs(imap, batchUids);
      const senders = extractSenderAddresses(batchMessages, listedEntries);

      if (senders.length === 0) {
        logger.info(
          { folder, type, total: batchMessages.length },
          `No extractable senders found among ${type} training messages; moving them on unlearned`
        );
      } else {
        // Training always appends - it merges newly extracted senders with
        // whatever's already in the mailbox's IMAP-backed list, never replaces it.
        const result = await updateListState(
          imap,
          mapStateKey,
          senders,
          'append',
          ctx
        );
        logger.info({ folder, type, ...result }, `${type} list updated`);
        senders.forEach(sender => listedEntries.add(sender));
      }

      // Move processed messages to destination folder
      await moveMessages(imap, batchMessages, destFolder);
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
 * @param imap - ImapFlow client
 * @param [ctx]
 */
export async function runWhitelist(
  imap: ImapFlow,
  ctx: Context = createDefaultContext()
): Promise<void> {
  await runMapTraining(
    imap,
    ctx.config.FOLDER_TRAIN_WHITELIST,
    ctx.config.STATE_KEY_WHITELIST_MAP,
    ctx.config.FOLDER_INBOX,
    'whitelist',
    ctx
  );
}

/**
 * Run blacklist training workflow: extracts senders and updates the
 * mailbox's IMAP-backed blacklist.
 * @param imap - ImapFlow client
 * @param [ctx]
 */
export async function runBlacklist(
  imap: ImapFlow,
  ctx: Context = createDefaultContext()
): Promise<void> {
  await runMapTraining(
    imap,
    ctx.config.FOLDER_TRAIN_BLACKLIST,
    ctx.config.STATE_KEY_BLACKLIST_MAP,
    ctx.config.FOLDER_SPAM,
    'blacklist',
    ctx
  );
}
