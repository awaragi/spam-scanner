import { moveMessages } from '../../clients/imap.client.js';
import { rootLogger } from '../../core/logger.js';
import { createDefaultContext } from '../../core/context.js';

const logger = rootLogger.forComponent('spam-move');

/**
 * Moves confirmed-spam messages (rspamd-confirmed plus blacklisted) to
 * FOLDER_SPAM. Unconditional and separate from the label/folder disposal
 * strategies - every processing mode moves confirmed spam the same way.
 * @param {Object} imap - ImapFlow client
 * @param {Array} spamMessages
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
export async function moveConfirmedSpam(
  imap,
  spamMessages,
  ctx = createDefaultContext()
) {
  const { config: cfg } = ctx;
  logger.debug(
    { count: spamMessages.length },
    'Moving spam messages to spam folder'
  );
  await moveMessages(imap, spamMessages, cfg.FOLDER_SPAM);
}
