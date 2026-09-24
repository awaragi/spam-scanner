import { rootLogger } from '../../core/logger.ts';
import { learnSpam, learnHam } from '../../clients/rspamd.client.ts';
import { isPermanentError } from '../../services/error-classifier.service.ts';
import { createDefaultContext, type Context } from '../../core/context.ts';

const logger = rootLogger.forComponent('rspamd-training');

interface TrainableMessage {
  uid: number;
  raw: unknown;
  envelope: { subject?: string; [key: string]: unknown };
}

type LearnFn = typeof learnSpam;

/**
 * Process a single message with Rspamd learning.
 * - A permanent-for-this-message error (e.g. HTTP 4xx) is logged at warn and
 *   resolved as `null` (skip marker) - it never rejects. The message was not
 *   learned, but the caller still moves it to the destination folder along
 *   with the learned ones: at scale, one unlearnable message is not worth
 *   leaving stuck in the training folder forever (it would just be retried,
 *   and fail the same way, on every future training run).
 * - A transient error (network, 5xx, timeout) rejects, so the caller can fail
 *   the whole batch for retry.
 * @param {Object} message - Message object with uid, envelope, raw
 * @param {Function} learnFn - Rspamd learn function (learnSpam or learnHam)
 * @param {string} type - Training type ('spam' or 'ham') for logging
 * @returns {Promise<Object|null>} - The message if learned, null if permanently skipped
 */
async function processWithRspamdLearn<M extends TrainableMessage>(
  message: M,
  learnFn: LearnFn,
  type: string
): Promise<M | null> {
  const { uid, raw } = message;
  const messageLogger = logger.forMessage(uid);
  messageLogger.debug({ type }, 'Learning message with rspamd');

  const subject = message.envelope.subject;
  try {
    const result = await learnFn(raw as string | Buffer);
    messageLogger.debug(
      { type, subject, result },
      'Message processed with rspamd learn'
    );
    return message;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (isPermanentError(err)) {
      messageLogger.warn(
        { type, subject, error: errorMessage },
        'rspamd learn failed permanently for this message - leaving it in the training folder, batch continues'
      );
      return null;
    }

    messageLogger.error(
      { type, subject, error: errorMessage },
      'rspamd learn process error'
    );
    throw err;
  }
}

/**
 * Trains a batch of messages with the given rspamd learn function.
 * Permanent per-message failures are skipped, not rejected, and are reported
 * back separately as `skipped` - the caller still moves them to the
 * destination folder (they just weren't learned) so a poison message doesn't
 * pile up in the training folder forever. A transient failure rejects the
 * whole call so the caller can retry the batch.
 * @param {Array} messages - Array of messages to train
 * @param {Function} learnFn - Rspamd learn function (learnSpam or learnHam)
 * @param {string} type - Training type ('spam' or 'ham') for logging
 * @returns {Promise<{learned: Array, skipped: Array}>} - Messages actually learned, and
 *   messages that permanently failed to learn but should still move on
 */
async function trainBatch<M extends TrainableMessage>(
  messages: M[],
  learnFn: LearnFn,
  type: string
): Promise<{ learned: M[]; skipped: M[] }> {
  if (messages.length === 0) {
    return { learned: [], skipped: [] };
  }

  const settled = await Promise.allSettled(
    messages.map(message => processWithRspamdLearn(message, learnFn, type))
  );

  const learned: M[] = [];
  const skipped: M[] = [];
  const failedUids: number[] = [];

  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      if (result.value !== null) {
        learned.push(result.value);
      } else {
        skipped.push(messages[index]);
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
    { type, learnedCount: learned.length, skippedCount: skipped.length },
    'All messages processed with rspamd learn'
  );
  return { learned, skipped };
}

/**
 * Train Rspamd with spam messages
 * @param {Array} messages - Array of spam messages
 * @param {Object} [ctx] - unused today; present for interface consistency across steps
 * @returns {Promise<{learned: Array, skipped: Array}>}
 */
export async function trainSpam<M extends TrainableMessage>(
  messages: M[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ctx: Context = createDefaultContext()
): Promise<{ learned: M[]; skipped: M[] }> {
  return trainBatch(messages, learnSpam, 'spam');
}

/**
 * Train Rspamd with ham (non-spam) messages
 * @param {Array} messages - Array of ham messages
 * @param {Object} [ctx] - unused today; present for interface consistency across steps
 * @returns {Promise<{learned: Array, skipped: Array}>}
 */
export async function trainHam<M extends TrainableMessage>(
  messages: M[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ctx: Context = createDefaultContext()
): Promise<{ learned: M[]; skipped: M[] }> {
  return trainBatch(messages, learnHam, 'ham');
}
