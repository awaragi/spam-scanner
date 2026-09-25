import { Injectable } from '@nestjs/common';
import type { MailboxSession } from '../mailbox-session.js';
import { ScanConfig } from '../../config/app-config.js';
import { RspamdGateway } from '../../infrastructure/rspamd/rspamd.gateway.js';
import {
  open,
  count,
  search,
  fetchMessagesByUIDs,
  moveMessages,
} from '../../infrastructure/imap/mailbox.gateway.js';
import { trainMessages, type LearnFn, type TrainableMessage } from './rspamd-training.step.js';

type TrainFn = (
  messages: TrainableMessage[],
  logger: MailboxSession['logger']
) => Promise<{ learned: TrainableMessage[]; skipped: TrainableMessage[] }>;

/**
 * Trains rspamd from a mailbox's `train.spam`/`train.ham` folders, ported
 * from terminal's `train.controller.ts` (workflow) plus its
 * `rspamd-training.step.ts` (per-batch learn/skip logic, kept as a
 * co-located pure step - see `rspamd-training.step.ts`).
 *
 * Training is best-effort and never fails the caller: unlike scanning (the
 * core function, where a systemic rspamd/IMAP outage should eventually
 * crash-loop and alert via `MAX_RETRIES`/process exit), a training folder is
 * secondary - any error (a transient rspamd/IMAP failure for a batch, or a
 * failure opening/reading the folder itself) is logged at `error` and
 * swallowed here rather than rethrown (`batch-processing-resilience`).
 * Batches already processed before the error stay moved; anything not yet
 * reached is simply left in the training folder to be picked up on the next
 * cycle.
 */
@Injectable()
export class RspamdTrainingService {
  constructor(
    private readonly rspamd: RspamdGateway,
    private readonly scanConfig: ScanConfig
  ) {}

  /**
   * Generic training workflow handler - never rejects, see class doc.
   * @param session - The mailbox session to train
   * @param folder - Training folder path
   * @param destFolder - Destination folder after training
   * @param trainFn - Training function (spam or ham learn, bound to the gateway)
   * @param type - Training type ('spam' or 'ham')
   */
  private async runTraining(
    session: MailboxSession,
    folder: string,
    destFolder: string,
    trainFn: TrainFn,
    type: string
  ): Promise<void> {
    const { imap, logger } = session;
    try {
      const box = await open(imap, folder, false, logger);
      const messageCount = count(box);

      if (messageCount === 0) {
        logger.debug({ folder }, 'No messages in folder to process');
        return;
      }

      const uids = await search(imap, { all: true }, logger);
      const { batchProcessSize } = this.scanConfig;

      // Search UIDs once, then fetch/train/move batchProcessSize messages at
      // a time - bounds how much message content is ever in memory at once,
      // and means a batch already trained and moved survives a later
      // batch's fetch failure (see `bounded-training-fetch`).
      for (let i = 0; i < uids.length; i += batchProcessSize) {
        logger.debug(
          {
            from: i,
            to: Math.min(i + batchProcessSize, uids.length),
            total: uids.length,
            type,
          },
          'Learn batch'
        );
        const batchUids = uids.slice(i, i + batchProcessSize);
        const batchMessages = (await fetchMessagesByUIDs(
          imap,
          batchUids,
          logger
        )) as unknown as TrainableMessage[];
        const { learned, skipped } = await trainFn(batchMessages, logger);
        if (skipped.length > 0) {
          logger.warn(
            { folder, type, count: skipped.length },
            'Some messages permanently failed to learn - moving them to the destination folder unlearned rather than leaving them stuck in the training folder'
          );
        }
        // Move every message this batch finished with (learned or
        // permanently un-learnable) - only a transient failure (thrown
        // above) should leave messages behind in the training folder for
        // retry.
        await moveMessages(imap, [...learned, ...skipped], destFolder, logger);
      }

      logger.info(
        { folder, type, total: uids.length },
        'All operations completed'
      );
    } catch (error) {
      logger.error(
        {
          folder,
          type,
          error: error instanceof Error ? error.message : String(error),
        },
        `Error in ${type} training workflow - skipping this training step for this cycle, will retry next cycle`
      );
    }
  }

  private trainSpam: LearnFn = raw => this.rspamd.learnSpam(raw);
  private trainHam: LearnFn = raw => this.rspamd.learnHam(raw);

  /**
   * Run spam training workflow. Never rejects - see class doc.
   * @param session - The mailbox session to train
   */
  async runSpam(session: MailboxSession): Promise<void> {
    await this.runTraining(
      session,
      session.folders.trainSpam,
      session.folders.spam,
      (messages, logger) => trainMessages(messages, this.trainSpam, 'spam', logger),
      'spam'
    );
  }

  /**
   * Run ham training workflow. Never rejects - see class doc.
   * @param session - The mailbox session to train
   */
  async runHam(session: MailboxSession): Promise<void> {
    await this.runTraining(
      session,
      session.folders.trainHam,
      session.folders.inbox,
      (messages, logger) => trainMessages(messages, this.trainHam, 'ham', logger),
      'ham'
    );
  }
}
