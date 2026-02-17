import {rootLogger} from '../utils/logger.js';
import {config} from '../utils/config.js';
import {open, count, fetchAllMessages, moveMessages} from '../clients/imap-client.js';
import {trainSpam, trainHam} from '../services/training-service.js';

const logger = rootLogger.forComponent('train-workflow');

const PROCESS_BATCH_SIZE = config.PROCESS_BATCH_SIZE;

/**
 * Generic training workflow handler
 * @param {Object} imap - ImapFlow client
 * @param {string} folder - Training folder path
 * @param {string} destFolder - Destination folder after training
 * @param {Function} trainFn - Training function (trainSpam or trainHam)
 * @param {string} type - Training type ('spam' or 'ham')
 * @returns {Promise<void>}
 */
async function runTraining(imap, folder, destFolder, trainFn, type) {
  try {
    const box = await open(imap, folder);
    const messageCount = count(box);

    if (messageCount === 0) {
      logger.info({folder}, 'No messages in folder to process');
      return;
    }

    const messages = await fetchAllMessages(imap);

    // Process messages in batches
    for (let i = 0; i < messages.length; i += PROCESS_BATCH_SIZE) {
      logger.info({
        from: i,
        to: Math.min(i + PROCESS_BATCH_SIZE, messages.length),
        total: messages.length,
        type,
      }, 'Learn batch');
      const batchMessages = messages.slice(i, i + PROCESS_BATCH_SIZE);
      await trainFn(batchMessages);
      await moveMessages(imap, batchMessages, destFolder);
    }

    logger.info({folder, type, total: messages.length}, 'All operations completed');
  } catch (error) {
    logger.error({folder, type, error: error.message}, `Error in ${type} training workflow`);
    throw error;
  }
}

/**
 * Run spam training workflow
 * Orchestrates learning spam from training folder
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<void>}
 */
export async function runSpam(imap) {
  await runTraining(imap, config.FOLDER_TRAIN_SPAM, config.FOLDER_SPAM, trainSpam, 'spam');
}

/**
 * Run ham training workflow
 * Orchestrates learning ham from training folder
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<void>}
 */
export async function runHam(imap) {
  await runTraining(imap, config.FOLDER_TRAIN_HAM, config.FOLDER_INBOX, trainHam, 'ham');
}
