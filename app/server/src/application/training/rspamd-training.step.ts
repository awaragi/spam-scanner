import type { Logger as PinoLogger } from 'pino';
import { isPermanentError } from '../../domain/classification/error-classifier.js';

/**
 * The minimal shape `trainMessages` needs from a message fetched via
 * `fetchMessagesByUIDs` - ported from terminal's `rspamd-training.step.ts`.
 */
export interface TrainableMessage {
  uid: number;
  raw: unknown;
  envelope: { subject?: string; [key: string]: unknown };
}

interface LearnResult {
  success: boolean;
  message?: string;
  alreadyLearned?: boolean;
  error?: string;
}

/** A gateway learn call (`RspamdGateway#learnSpam`/`#learnHam`), bound by the caller. */
export type LearnFn = (raw: string | Buffer) => Promise<LearnResult>;

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
 * @param message - Message object with uid, envelope, raw
 * @param learnFn - Rspamd learn function (bound `learnSpam`/`learnHam`)
 * @param type - Training type ('spam' or 'ham') for logging
 * @param logger - Session-scoped logger
 * @returns - The message if learned, null if permanently skipped
 */
async function processWithRspamdLearn<M extends TrainableMessage>(
  message: M,
  learnFn: LearnFn,
  type: string,
  logger?: PinoLogger
): Promise<M | null> {
  const { uid, raw } = message;
  const subject = message.envelope.subject;
  logger?.debug({ uid, type }, 'Learning message with rspamd');

  try {
    const result = await learnFn(raw as string | Buffer);
    logger?.debug(
      { uid, type, subject, result },
      'Message processed with rspamd learn'
    );
    return message;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    if (isPermanentError(err)) {
      logger?.warn(
        { uid, type, subject, error: errorMessage },
        'rspamd learn failed permanently for this message - leaving it in the training folder, batch continues'
      );
      return null;
    }

    logger?.error(
      { uid, type, subject, error: errorMessage },
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
 * @param messages - Array of messages to train
 * @param learnFn - Rspamd learn function (bound `learnSpam`/`learnHam`)
 * @param type - Training type ('spam' or 'ham') for logging
 * @param logger - Session-scoped logger
 * @returns - Messages actually learned, and messages that permanently failed
 *   to learn but should still move on
 */
export async function trainMessages<M extends TrainableMessage>(
  messages: M[],
  learnFn: LearnFn,
  type: string,
  logger?: PinoLogger
): Promise<{ learned: M[]; skipped: M[] }> {
  if (messages.length === 0) {
    return { learned: [], skipped: [] };
  }

  const settled = await Promise.allSettled(
    messages.map(message => processWithRspamdLearn(message, learnFn, type, logger))
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

  logger?.info(
    { type, learnedCount: learned.length, skippedCount: skipped.length },
    'All messages processed with rspamd learn'
  );
  return { learned, skipped };
}
