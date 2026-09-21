import { rootLogger } from '../../core/logger.js';
import { checkEmail } from '../../clients/rspamd.client.js';
import { parseRspamdOutput } from '../../utils/email-parser.util.js';
import { dateToString } from '../../utils/email.util.js';
import { isPermanentError } from '../../services/error-classifier.service.js';
import { createDefaultContext } from '../../core/context.js';

const logger = rootLogger.forComponent('rspamd-check');

/**
 * Process a single message with Rspamd, returning the message with spamInfo
 * attached on success.
 * - A permanent-for-this-message error (e.g. HTTP 4xx, unparsable response)
 *   is logged at warn and resolved as `null` (skip marker) - it never rejects.
 * - A transient error (network, 5xx, timeout) rejects, so the caller can fail
 *   the whole batch for retry.
 */
async function processOneMessage(message) {
  const { uid, envelope, raw } = message;
  const messageLogger = logger.forMessage(uid);
  const subject = envelope.subject;
  const date = dateToString(envelope.date);

  messageLogger.debug({ date, subject }, 'Starting Rspamd check');

  try {
    messageLogger.debug('Checking email with Rspamd');
    const result = await checkEmail(raw);

    messageLogger.debug(
      { subject, action: result.action, score: result.score },
      'Rspamd check completed'
    );

    const { score, required } = parseRspamdOutput(result);

    messageLogger.debug(
      { score, required, date, subject },
      'Rspamd scan results'
    );

    // Return message with spam information attached
    return {
      ...message,
      spamInfo: {
        score,
        required,
        subject,
        date,
      },
    };
  } catch (err) {
    if (isPermanentError(err)) {
      messageLogger.warn(
        { subject, error: err.message },
        'Rspamd check failed permanently for this message - skipping it, batch continues'
      );
      return null;
    }

    messageLogger.error({ error: err.message }, 'Rspamd check process error');
    throw err;
  }
}

/**
 * Process messages with Rspamd spam checking. Attaches spam information to
 * each message. A permanent failure on one message never blocks the rest of
 * the batch; a transient failure fails the whole call so the caller's
 * existing retry-the-batch behavior applies. Whitelist membership is not
 * this step's concern - it only calls rspamd and returns its raw
 * score/required; see `spam-classifier.service.js`'s `applyWhitelistAdjustments`
 * for the score adjustment.
 * @param {Array} messages - Array of message objects with uid, envelope, raw
 * @param {Object} [ctx] - unused today; present for interface consistency across steps
 * @returns {Promise<Array>} - Array of messages with spamInfo attached
 */
export async function processWithRspamd(
  messages,
  ctx = createDefaultContext() // eslint-disable-line no-unused-vars
) {
  if (messages.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    messages.map(message => processOneMessage(message))
  );

  const processedMessages = [];
  const failedUids = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value !== null) {
        processedMessages.push(result.value);
      }
    } else {
      failedUids.push(messages[index].uid);
    }
  });

  if (failedUids.length > 0) {
    throw new Error(
      `Rspamd check failed transiently for ${failedUids.length} message(s): ${failedUids.join(', ')}`
    );
  }

  logger.info(
    { total: processedMessages.length },
    'Messages processed with Rspamd'
  );
  return processedMessages;
}
