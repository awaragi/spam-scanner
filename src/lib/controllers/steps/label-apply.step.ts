import { updateLabels } from '../../clients/imap.client.ts';
import { rootLogger } from '../../core/logger.ts';
import { createDefaultContext } from '../../core/context.ts';

const logger = rootLogger.forComponent('label-apply');

/**
 * Applies Gmail-style labels to messages based on their spam tier. The
 * current default processing mode.
 * @param {Object} imap - ImapFlow client
 * @param {{nonSpamMessages: Array, lowSpamMessages: Array, highSpamMessages: Array}} categorized
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
export async function applyLabels(
  imap,
  { nonSpamMessages, lowSpamMessages, highSpamMessages },
  ctx = createDefaultContext()
) {
  const { LABEL_SPAM_LOW, LABEL_SPAM_HIGH } = ctx.config;
  logger.debug({ mode: 'label' }, 'Processing messages with label strategy');

  // Reset spam labels on non-spam messages
  logger.debug(
    { count: nonSpamMessages.length },
    'Resetting spam labels on clean messages'
  );
  await updateLabels(
    imap,
    nonSpamMessages,
    [],
    [LABEL_SPAM_LOW, LABEL_SPAM_HIGH]
  );

  // Apply Spam:Low label
  logger.debug({ count: lowSpamMessages.length }, 'Applying Spam:Low label');
  await updateLabels(
    imap,
    lowSpamMessages,
    [LABEL_SPAM_LOW],
    [LABEL_SPAM_HIGH]
  );

  // Apply Spam:High label
  logger.debug({ count: highSpamMessages.length }, 'Applying Spam:High label');
  await updateLabels(
    imap,
    highSpamMessages,
    [LABEL_SPAM_HIGH],
    [LABEL_SPAM_LOW]
  );

  logger.debug('Label processing completed');
}
