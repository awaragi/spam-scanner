import {rootLogger} from '../utils/logger.js';
import {checkEmail} from '../clients/rspamd-client.js';
import {parseRspamdOutput} from '../utils/email-parser.js';
import {dateToString} from '../utils/email.js';

const logger = rootLogger.forComponent('message-service');

/**
 * Process messages with Rspamd spam checking
 * Attaches spam information to each message
 * @param {Array} messages - Array of message objects with uid, envelope, raw
 * @returns {Promise<Array>} - Array of messages with spamInfo attached
 */
export async function processWithRspamd(messages) {
  if (messages.length === 0) {
    return [];
  }

  const processedMessages = [];

  await Promise.all(messages.map(async message => {
    const {uid, envelope, raw} = message;
    const messageLogger = logger.forMessage(uid);
    const subject = envelope.subject;
    const date = dateToString(envelope.date);

    messageLogger.info({date, subject}, 'Starting Rspamd check');

    try {
      messageLogger.debug('Checking email with Rspamd');
      const result = await checkEmail(raw);

      messageLogger.info({subject, action: result.action, score: result.score}, 'Rspamd check completed');

      // Parse Rspamd output
      const {score, required, level, isSpam} = parseRspamdOutput(result);
      messageLogger.info({score, required, level, isSpam, date, subject}, 'Rspamd scan results');

      // Add message to processed messages with spam information
      const messageWithSpamInfo = {...message, spamInfo: {score, required, level, isSpam, subject, date}};

      processedMessages.push(messageWithSpamInfo);
    } catch (err) {
      messageLogger.error({error: err.message}, 'Rspamd check process error');
      throw err;
    }
  }));

  logger.info({total: processedMessages.length}, 'Messages processed with Rspamd');
  return processedMessages;
}
