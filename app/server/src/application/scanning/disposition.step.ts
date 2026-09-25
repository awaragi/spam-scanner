import { Injectable } from '@nestjs/common';
import {
  updateLabels,
  moveMessages,
} from '../../infrastructure/imap/mailbox.gateway.js';
import type { MailboxSession } from '../mailbox-session.js';

interface CategorizedMessages {
  nonSpamMessages: Array<{ uid: number }>;
  lowSpamMessages: Array<{ uid: number }>;
  highSpamMessages: Array<{ uid: number }>;
}

/**
 * Disposes of a categorized batch of messages, merging terminal's
 * `label-apply.step.ts`, `folder-move.step.ts` and `spam-move.step.ts` into
 * one file, per design.md D1 ("disposition.step.ts merging
 * label-apply/folder-move/spam-move").
 *
 * Kept as three separate exported methods on one injectable, rather than
 * one combined `dispose()` method, so `scan.service.ts` keeps the same
 * mode-resolution responsibility terminal's `scan.controller.ts` had -
 * terminal's own comment on `resolveProcessFn` called that "ordinary
 * controller-level wiring, not a hidden business rule", and moving it here
 * instead would turn a wiring decision into a second, harder-to-see
 * business rule buried inside this step. `moveConfirmedSpam` stays
 * unconditional and separate from the label/folder strategies, exactly as
 * in terminal - every processing mode moves confirmed spam the same way.
 */
@Injectable()
export class DispositionStep {
  /**
   * Applies Gmail-style labels to messages based on their spam tier. The
   * current default processing mode.
   */
  async applyLabels(
    {
      nonSpamMessages,
      lowSpamMessages,
      highSpamMessages,
    }: CategorizedMessages,
    session: MailboxSession
  ): Promise<void> {
    const { imap, settings, logger } = session;
    const { spamLow, spamHigh } = settings.labels;
    logger.debug({ mode: 'label' }, 'Processing messages with label strategy');

    // Reset spam labels on non-spam messages
    logger.debug(
      { count: nonSpamMessages.length },
      'Resetting spam labels on clean messages'
    );
    await updateLabels(imap, nonSpamMessages, [], [spamLow, spamHigh], logger);

    // Apply Spam:Low label
    logger.debug({ count: lowSpamMessages.length }, 'Applying Spam:Low label');
    await updateLabels(imap, lowSpamMessages, [spamLow], [spamHigh], logger);

    // Apply Spam:High label
    logger.debug(
      { count: highSpamMessages.length },
      'Applying Spam:High label'
    );
    await updateLabels(imap, highSpamMessages, [spamHigh], [spamLow], logger);

    logger.debug('Label processing completed');
  }

  /**
   * Moves messages to spam-likelihood folders based on their spam tier.
   */
  async moveToFolders(
    {
      nonSpamMessages,
      lowSpamMessages,
      highSpamMessages,
    }: CategorizedMessages,
    session: MailboxSession
  ): Promise<void> {
    const { imap, folders, logger } = session;
    logger.debug(
      { mode: 'folder' },
      'Processing messages with folder strategy'
    );

    if (!folders.spamLow) {
      throw new Error(
        'FOLDER_SPAM_LOW configuration is required for folder processing mode'
      );
    }

    if (!folders.spamHigh) {
      throw new Error(
        'FOLDER_SPAM_HIGH configuration is required for folder processing mode'
      );
    }

    logger.debug(
      { count: nonSpamMessages.length, folder: folders.inbox },
      'Not touching non-spam messages'
    );

    logger.debug(
      { count: lowSpamMessages.length, folder: folders.spamLow },
      'Moving low spam messages'
    );
    await moveMessages(imap, lowSpamMessages, folders.spamLow, logger);

    logger.debug(
      { count: highSpamMessages.length, folder: folders.spamHigh },
      'Moving high spam messages'
    );
    await moveMessages(imap, highSpamMessages, folders.spamHigh, logger);

    logger.debug('Folder processing completed');
  }

  /**
   * Moves confirmed-spam messages (rspamd-confirmed plus blacklisted) to
   * the mailbox's spam folder. Unconditional and separate from the
   * label/folder disposal strategies - every processing mode moves
   * confirmed spam the same way.
   */
  async moveConfirmedSpam(
    spamMessages: Array<{ uid: number }>,
    session: MailboxSession
  ): Promise<void> {
    const { imap, folders, logger } = session;
    logger.debug(
      { count: spamMessages.length },
      'Moving spam messages to spam folder'
    );
    await moveMessages(imap, spamMessages, folders.spam, logger);
  }
}
