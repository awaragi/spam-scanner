import { rootLogger } from '../../core/logger.js';
import { appendMessage } from '../../clients/imap.client.js';
import { learnHam } from '../../clients/rspamd.client.js';
import { buildAiFailureAlertEmail } from '../../services/alert-email.service.js';
import { createDefaultContext } from '../../core/context.js';

const logger = rootLogger.forComponent('ai-failure-alert');

/**
 * Posts a one-time INBOX alert when the batch's AI failures crossed the
 * consecutive-same-reason threshold. Best-effort: an append failure is logged
 * and left un-notified in the tracker so the next failure retries the post.
 *
 * Also trains rspamd's Bayes classifier that this exact template is ham
 * (fire-and-forget - a training failure never blocks the alert itself). This
 * is the same `learnHam` mechanism the ham-training folder uses, not the
 * whitelist map, and is what keeps the alert reliably out of rspamd's spam
 * buckets on future occurrences (Message-ID alone clears the default
 * threshold but by a thin margin; Bayes training widens it considerably).
 * @param {Object} imap - ImapFlow client
 * @param {{reason: string, count: number, lastError: string, lastAt: string}|null} alert
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
export async function postAiFailureAlert(
  imap,
  alert,
  ctx = createDefaultContext()
) {
  if (!alert) {
    return;
  }
  const notifyAddress = ctx.config.IMAP_NOTIFY_ADDRESS || ctx.config.IMAP_USER;
  const raw = buildAiFailureAlertEmail(alert, notifyAddress);
  try {
    await appendMessage(imap, ctx.config.FOLDER_INBOX, raw);
    ctx.aiFailureTracker.markNotified(alert.reason);
    logger.warn(alert, 'Posted AI failure alert to INBOX');
  } catch (err) {
    logger.error(
      { ...alert, error: err.message },
      'Failed to post AI failure alert to INBOX - will retry on next failure'
    );
    return;
  }

  try {
    await learnHam(raw);
  } catch (err) {
    logger.warn(
      { error: err.message },
      'Failed to train rspamd on the AI failure alert template (non-critical)'
    );
  }
}
