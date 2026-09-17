import { rootLogger } from '../utils/logger.js';
import { learnSpam, learnHam } from '../clients/rspamd-client.js';
import { isPermanentError } from '../utils/error-classifier.js';

const logger = rootLogger.forComponent('training-service');

/**
 * Process a single message with Rspamd learning.
 * - A permanent-for-this-message error (e.g. HTTP 4xx) is logged at warn and
 *   resolved as `null` (skip marker) - it never rejects, and the message is
 *   left un-learned (the caller must not move it to the destination folder).
 * - A transient error (network, 5xx, timeout) rejects, so the caller can fail
 *   the whole batch for retry.
 * @param {Object} message - Message object with uid, envelope, raw
 * @param {Function} learnFn - Rspamd learn function (learnSpam or learnHam)
 * @param {string} type - Training type ('spam' or 'ham') for logging
 * @returns {Promise<Object|null>} - The message if learned, null if permanently skipped
 */
async function processWithRspamdLearn(message, learnFn, type) {
  const { uid, raw } = message;
  const messageLogger = logger.forMessage(uid);
  messageLogger.debug({ type }, 'Learning message with rspamd');

  const subject = message.envelope.subject;
  try {
    const result = await learnFn(raw);
    messageLogger.debug(
      { type, subject, result },
      'Message processed with rspamd learn'
    );
    return message;
  } catch (err) {
    if (isPermanentError(err)) {
      messageLogger.warn(
        { type, subject, error: err.message },
        'rspamd learn failed permanently for this message - leaving it in the training folder, batch continues'
      );
      return null;
    }

    messageLogger.error(
      { type, subject, error: err.message },
      'rspamd learn process error'
    );
    throw err;
  }
}

/**
 * Trains a batch of messages with the given rspamd learn function.
 * Permanent per-message failures are skipped (never rejected); a transient
 * failure rejects the whole call so the caller can retry the batch.
 * @param {Array} messages - Array of messages to train
 * @param {Function} learnFn - Rspamd learn function (learnSpam or learnHam)
 * @param {string} type - Training type ('spam' or 'ham') for logging
 * @returns {Promise<{learned: Array}>} - Messages that were actually learned
 */
async function trainBatch(messages, learnFn, type) {
  if (messages.length === 0) {
    return { learned: [] };
  }

  const settled = await Promise.allSettled(
    messages.map(message => processWithRspamdLearn(message, learnFn, type))
  );

  const learned = [];
  const failedUids = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value !== null) {
        learned.push(result.value);
      }
    } else {
      failedUids.push(messages[index].uid);
    }
  });

  if (failedUids.length > 0) {
    throw new Error(
      `rspamd learn (${type}) failed transiently for ${failedUids.length} message(s): ${failedUids.join(', ')}`
    );
  }

  logger.info(
    { type, processedCount: learned.length },
    'All messages processed with rspamd learn'
  );
  return { learned };
}

/**
 * Train Rspamd with spam messages
 * @param {Array} messages - Array of spam messages
 * @returns {Promise<{learned: Array}>} - Messages that were actually learned
 */
export async function trainSpam(messages) {
  return trainBatch(messages, learnSpam, 'spam');
}

/**
 * Train Rspamd with ham (non-spam) messages
 * @param {Array} messages - Array of ham messages
 * @returns {Promise<{learned: Array}>} - Messages that were actually learned
 */
export async function trainHam(messages) {
  return trainBatch(messages, learnHam, 'ham');
}
