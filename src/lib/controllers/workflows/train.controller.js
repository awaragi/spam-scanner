import { rootLogger } from '../../core/logger.js';
import {
  open,
  count,
  search,
  fetchMessagesByUIDs,
  moveMessages,
} from '../../clients/imap.client.js';
import { trainSpam, trainHam } from '../steps/rspamd-training.step.js';
import { createDefaultContext } from '../../core/context.js';

const logger = rootLogger.forComponent('train-controller');

/**
 * Generic training workflow handler.
 * Training is best-effort and never fails the orchestrator cycle: unlike
 * scanning (the core function, where a systemic rspamd/IMAP outage should
 * eventually crash-loop and alert via MAX_RETRIES/process.exit), a training
 * folder is secondary - any error (a transient rspamd/IMAP failure for a
 * batch, or a failure opening/reading the folder itself) is logged at
 * `error` and swallowed here rather than rethrown. Batches already
 * processed before the error stay moved; anything not yet reached is simply
 * left in the training folder to be picked up on the next cycle.
 * @param {Object} imap - ImapFlow client
 * @param {string} folder - Training folder path
 * @param {string} destFolder - Destination folder after training
 * @param {Function} trainFn - Training function (trainSpam or trainHam)
 * @param {string} type - Training type ('spam' or 'ham')
 * @param {Object} ctx
 * @returns {Promise<void>} - Never rejects
 */
async function runTraining(imap, folder, destFolder, trainFn, type, ctx) {
  try {
    const box = await open(imap, folder);
    const messageCount = count(box);

    if (messageCount === 0) {
      logger.debug({ folder }, 'No messages in folder to process');
      return;
    }

    const uids = await search(imap, { all: true });
    const { BATCH_PROCESS_SIZE } = ctx.config;

    // Search UIDs once, then fetch/train/move BATCH_PROCESS_SIZE messages at a
    // time - bounds how much message content is ever in memory at once, and
    // means a batch already trained and moved survives a later batch's fetch
    // failure (see `bounded-training-fetch`).
    for (let i = 0; i < uids.length; i += BATCH_PROCESS_SIZE) {
      logger.debug(
        {
          from: i,
          to: Math.min(i + BATCH_PROCESS_SIZE, uids.length),
          total: uids.length,
          type,
        },
        'Learn batch'
      );
      const batchUids = uids.slice(i, i + BATCH_PROCESS_SIZE);
      const batchMessages = await fetchMessagesByUIDs(imap, batchUids);
      const { learned, skipped } = await trainFn(batchMessages, ctx);
      if (skipped.length > 0) {
        logger.warn(
          { folder, type, count: skipped.length },
          'Some messages permanently failed to learn - moving them to the destination folder unlearned rather than leaving them stuck in the training folder'
        );
      }
      // Move every message this batch finished with (learned or permanently
      // un-learnable) - only a transient failure (thrown above) should leave
      // messages behind in the training folder for retry.
      await moveMessages(imap, [...learned, ...skipped], destFolder);
    }

    logger.info(
      { folder, type, total: uids.length },
      'All operations completed'
    );
  } catch (error) {
    logger.error(
      { folder, type, error: error.message },
      `Error in ${type} training workflow - skipping this training step for this cycle, will retry next cycle`
    );
  }
}

/**
 * Run spam training workflow. Never rejects - see `runTraining`.
 * @param {Object} imap - ImapFlow client
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
export async function runSpam(imap, ctx = createDefaultContext()) {
  await runTraining(
    imap,
    ctx.config.FOLDER_TRAIN_SPAM,
    ctx.config.FOLDER_SPAM,
    trainSpam,
    'spam',
    ctx
  );
}

/**
 * Run ham training workflow. Never rejects - see `runTraining`.
 * @param {Object} imap - ImapFlow client
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
export async function runHam(imap, ctx = createDefaultContext()) {
  await runTraining(
    imap,
    ctx.config.FOLDER_TRAIN_HAM,
    ctx.config.FOLDER_INBOX,
    trainHam,
    'ham',
    ctx
  );
}
