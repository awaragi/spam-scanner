import {rootLogger} from '../utils/logger.js';
import {learnSpam, learnHam} from '../clients/rspamd-client.js';

const logger = rootLogger.forComponent('training-service');

/**
 * Process a single message with Rspamd learning
 * @param {Object} message - Message object with uid, envelope, raw
 * @param {Function} learnFn - Rspamd learn function (learnSpam or learnHam)
 * @param {string} type - Training type ('spam' or 'ham') for logging
 * @returns {Promise<void>}
 */
async function processWithRspamdLearn(message, learnFn, type) {
  const {uid, raw} = message;
  const messageLogger = logger.forMessage(uid);
  messageLogger.info({type}, 'Learning message with rspamd');

  const subject = message.envelope.subject;
  try {
    const result = await learnFn(raw);
    messageLogger.info({type, subject, result}, 'Message processed with rspamd learn');
  } catch (err) {
    messageLogger.error({type, subject, error: err.message}, 'rspamd learn process error');
    throw err;
  }
}

/**
 * Train Rspamd with spam messages
 * @param {Array} messages - Array of spam messages
 * @returns {Promise<void>}
 */
export async function trainSpam(messages) {
  if (messages.length === 0) {
    return;
  }

  let processedCount = 0;
  await Promise.all(messages.map(async message => {
    await processWithRspamdLearn(message, learnSpam, 'spam');
    processedCount++;
  }));

  logger.info({type: 'spam', processedCount}, 'All messages processed with rspamd learn');
}

/**
 * Train Rspamd with ham (non-spam) messages
 * @param {Array} messages - Array of ham messages
 * @returns {Promise<void>}
 */
export async function trainHam(messages) {
  if (messages.length === 0) {
    return;
  }

  let processedCount = 0;
  await Promise.all(messages.map(async message => {
    await processWithRspamdLearn(message, learnHam, 'ham');
    processedCount++;
  }));

  logger.info({type: 'ham', processedCount}, 'All messages processed with rspamd learn');
}
