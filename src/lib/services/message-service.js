import { rootLogger } from '../utils/logger.js';
import { checkEmail } from '../clients/rspamd-client.js';
import { parseRspamdOutput } from '../utils/email-parser.js';
import { dateToString } from '../utils/email.js';
import { isPermanentError } from '../utils/error-classifier.js';
import { senderAddressOf } from '../utils/sender-lists.js';

const logger = rootLogger.forComponent('message-service');

/**
 * Process a single message with Rspamd, returning the message with spamInfo
 * attached on success.
 * - A permanent-for-this-message error (e.g. HTTP 4xx, unparsable response)
 *   is logged at warn and resolved as `null` (skip marker) - it never rejects.
 * - A transient error (network, 5xx, timeout) rejects, so the caller can fail
 *   the whole batch for retry.
 * A whitelist match subtracts 20 from rspamd's raw score before it's used
 * for categorization (see `spam-classifier.js`) - the same adjustment
 * rspamd's own multimap rule used to apply internally, now computed here
 * since rspamd is a stateless content scorer with no list awareness.
 */
async function processOneMessage(message, whitelistSet) {
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

    const { score: rawScore, required } = parseRspamdOutput(result);
    const sender = senderAddressOf(message);
    const isWhitelisted = whitelistSet.has(sender);
    const score = isWhitelisted ? rawScore - 20 : rawScore;

    if (isWhitelisted) {
      messageLogger.debug(
        { sender, rawScore, adjustedScore: score, adjustment: -20 },
        'Whitelist match - subtracting 20 from score'
      );
    }

    messageLogger.debug(
      { score, rawScore, required, isWhitelisted, date, subject },
      'Rspamd scan results'
    );

    // Return message with spam information attached
    return {
      ...message,
      spamInfo: {
        score,
        required,
        isWhitelisted,
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
 * Process messages with Rspamd spam checking
 * Attaches spam information to each message. A permanent failure on one
 * message never blocks the rest of the batch; a transient failure fails the
 * whole call so the caller's existing retry-the-batch behavior applies.
 * @param {Array} messages - Array of message objects with uid, envelope, raw
 * @param {Set<string>} whitelistSet - Normalized whitelist addresses, for score adjustment
 * @returns {Promise<Array>} - Array of messages with spamInfo attached
 */
export async function processWithRspamd(messages, whitelistSet) {
  if (messages.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    messages.map(message => processOneMessage(message, whitelistSet))
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
