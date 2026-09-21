import { rootLogger } from '../../core/logger.js';
import {
  open,
  count,
  search,
  fetchMessageHeadersByUIDs,
  moveMessages,
  updateLabels,
} from '../../clients/imap.client.js';
import { extractSenderAddresses } from '../../services/sender-lists.service.js';
import { updateListState } from '../steps/list-update.step.js';
import { createDefaultContext } from '../../core/context.js';
import { TRAINED_FLAG } from '../../services/spam-classifier.service.js';

const logger = rootLogger.forComponent('sender-list-training-controller');

/**
 * Generic map training workflow handler
 * @param {Object} imap - ImapFlow client
 * @param {string} folder - Training folder path
 * @param {string} mapStateKey - State key identifying the mailbox's IMAP-backed whitelist/blacklist (see config.js STATE_KEY_WHITELIST_MAP/STATE_KEY_BLACKLIST_MAP)
 * @param {string} destFolder - Destination folder after processing
 * @param {string} type - Map type ('whitelist' or 'blacklist')
 * @param {Object} ctx
 * @param {boolean} [tagAsTrained] - When true, flag every moved message with
 *   `TRAINED_FLAG` before the move, exempting it from AI re-escalation on its
 *   next scan (see `training-reescalation-guard`). Only meaningful when
 *   `destFolder` is scanned (i.e. whitelist training, not blacklist training).
 * @returns {Promise<void>}
 */
async function runMapTraining(
  imap,
  folder,
  mapStateKey,
  destFolder,
  type,
  ctx,
  tagAsTrained = false
) {
  try {
    const box = await open(imap, folder);
    const messageCount = count(box);

    if (messageCount === 0) {
      logger.debug({ folder, type }, 'No messages in training folder');
      return;
    }

    const uids = await search(imap, { all: true });
    const { PROCESS_BATCH_SIZE } = ctx.config;

    // Search UIDs once, then fetch/extract/move PROCESS_BATCH_SIZE messages
    // at a time - bounds how much message content is ever in memory at once,
    // fetches headers only (never the full source/body map training doesn't
    // need), and means a batch already extracted and moved survives a later
    // batch's fetch failure (see `bounded-training-fetch`). Each batch's
    // list-state update appends independently - append mode merges with
    // whatever's already stored, so per-batch calls compose correctly into
    // the same end state as a single call over every sender would.
    for (let i = 0; i < uids.length; i += PROCESS_BATCH_SIZE) {
      const batchUids = uids.slice(i, i + PROCESS_BATCH_SIZE);
      const batchMessages = await fetchMessageHeadersByUIDs(imap, batchUids);
      const senders = extractSenderAddresses(batchMessages);

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
      }

      // Move processed messages to destination folder
      if (tagAsTrained) {
        await updateLabels(imap, batchMessages, [TRAINED_FLAG]);
      }
      await moveMessages(imap, batchMessages, destFolder);
      logger.debug(
        { folder, type, destFolder, total: batchMessages.length },
        'Training messages moved'
      );
    }
  } catch (error) {
    logger.error(
      { folder, type, error: error.message },
      `Error in ${type} workflow`
    );
    throw error;
  }
}

/**
 * Run whitelist training workflow: extracts senders and updates the
 * mailbox's IMAP-backed whitelist.
 * @param {Object} imap - ImapFlow client
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
export async function runWhitelist(imap, ctx = createDefaultContext()) {
  await runMapTraining(
    imap,
    ctx.config.FOLDER_TRAIN_WHITELIST,
    ctx.config.STATE_KEY_WHITELIST_MAP,
    ctx.config.FOLDER_INBOX,
    'whitelist',
    ctx,
    true
  );
}

/**
 * Run blacklist training workflow: extracts senders and updates the
 * mailbox's IMAP-backed blacklist.
 * @param {Object} imap - ImapFlow client
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
export async function runBlacklist(imap, ctx = createDefaultContext()) {
  await runMapTraining(
    imap,
    ctx.config.FOLDER_TRAIN_BLACKLIST,
    ctx.config.STATE_KEY_BLACKLIST_MAP,
    ctx.config.FOLDER_SPAM,
    'blacklist',
    ctx
  );
}
