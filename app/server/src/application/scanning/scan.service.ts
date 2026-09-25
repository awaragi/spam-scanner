import { Injectable } from '@nestjs/common';
import { ScanConfig, AiConfig } from '../../config/app-config.js';
import { fetchMessagesByUIDs } from '../../infrastructure/imap/mailbox.gateway.js';
import { writeScannerState } from '../../infrastructure/state/scanner-state.repository.js';
import {
  categorizeMessages,
  applyAiEscalation,
  applyWhitelistAdjustments,
  partitionByWhitelistFlag,
  mergeWhitelistedBack,
} from '../../domain/classification/spam-classifier.js';
import { partitionBySender } from '../../domain/sender-lists/sender-lists.js';
import {
  computeScanProgress,
  sumBatchTotals,
} from '../../domain/scanning/scan-progress.js';
import type { ScannerState } from '../../domain/state/state-format.js';
import { PendingMessagesStep } from './pending-messages.step.js';
import { RspamdCheckStep } from './rspamd-check.step.js';
import { AiClassificationStep } from './ai-classification.step.js';
import { DispositionStep } from './disposition.step.js';
import { SenderListLookupStep } from './sender-list-lookup.step.js';
import type { MailboxSession } from '../mailbox-session.js';

/**
 * The one concrete message shape this service threads through the whole
 * pipeline (fetch -> blacklist split -> rspamd -> whitelist -> categorize ->
 * AI -> dispose -> progress). Every step/domain function it calls takes its
 * own small structural interface (see each file's own local Message-shaped
 * type) - this is the shape that satisfies all of them simultaneously.
 */
interface ScanMessage {
  uid: number;
  flags: unknown;
  envelope: {
    subject?: string;
    date: unknown;
    from?: Array<{ address?: string; name?: string }>;
    to?: Array<{ address?: string; name?: string }>;
  };
  raw: Buffer;
}

interface CategorizedMessages {
  nonSpamMessages: Array<{ uid: number }>;
  lowSpamMessages: Array<{ uid: number }>;
  highSpamMessages: Array<{ uid: number }>;
}

interface BatchTotals {
  lowSpamTotal: number;
  highSpamTotal: number;
  nonSpamTotal: number;
  spamTotal: number;
  whitelistedTotal: number;
}

/**
 * Orchestrates a full inbox scan for one mailbox: read state, search, batch
 * process, update state. Ported from terminal's `scan.controller.ts`
 * (`runScan`/`scanBatch`), taking a `MailboxSession` instead of
 * `(imap, ctx)` - see design.md D4. `BATCH_PROCESS_SIZE` and the global
 * `AI_ENABLED` switch come from injected config sections; everything else
 * per-mailbox (folders, processing mode, thresholds, AI escalation
 * thresholds, the per-mailbox `aiEnabled` opt-out) comes from
 * `session.settings`/`session.folders` (design.md D5).
 *
 * Unlike terminal, this never posts an AI-failure alert email - that step is
 * a documented non-goal of this change (see `ai-classification.step.ts`).
 */
@Injectable()
export class ScanService {
  constructor(
    private readonly scanConfig: ScanConfig,
    private readonly aiConfig: AiConfig,
    private readonly pendingMessagesStep: PendingMessagesStep,
    private readonly rspamdCheckStep: RspamdCheckStep,
    private readonly aiClassificationStep: AiClassificationStep,
    private readonly dispositionStep: DispositionStep,
    private readonly senderListLookupStep: SenderListLookupStep
  ) {}

  /**
   * Resolves the processing strategy for a categorized batch. Ordinary
   * service-level wiring, not a hidden business rule - this is where
   * `processingMode`'s mode switch (and its unknown-mode throw) lives, kept
   * here rather than in `disposition.step.ts` (see that file's module doc
   * comment).
   */
  private async disposeCategorized(
    categorized: CategorizedMessages,
    session: MailboxSession
  ): Promise<void> {
    switch (session.settings.processingMode) {
      case 'label':
        await this.dispositionStep.applyLabels(categorized, session);
        return;
      case 'folder':
        await this.dispositionStep.moveToFolders(categorized, session);
        return;
      default:
        throw new Error(
          `Unknown processing mode: ${String(session.settings.processingMode)}. Expected 'label' or 'folder'`
        );
    }
  }

  /**
   * Scan and process a batch of messages.
   * @param session - the mailbox session
   * @param uids - Array of message UIDs to process
   * @param state - Current scanner state (mutated: state.last_uid advances)
   * @param lists - Sender lists loaded once per `runScan` call
   * @returns Counts of processed messages by category
   */
  private async scanBatch(
    session: MailboxSession,
    uids: number[],
    state: ScannerState,
    lists: { whitelistSet: Set<string>; blacklistSet: Set<string> }
  ): Promise<BatchTotals> {
    const { imap, settings, folders, logger } = session;
    const { whitelistSet, blacklistSet } = lists;
    const messages = (await fetchMessagesByUIDs(
      imap,
      uids,
      logger
    )) as unknown as ScanMessage[];

    // Blacklist check precedes the rspamd call entirely (see the
    // `sender-lists` capability) - a blacklisted sender is confirmed spam
    // unconditionally, with no content scoring and no AI review. Everyone
    // else proceeds to rspamd as before.
    const { matched: blacklistedMessages, rest: remainingMessages } =
      partitionBySender(messages, blacklistSet);

    const checkedMessages = await this.rspamdCheckStep.check(
      remainingMessages,
      session
    );
    const { messages: processedMessages, whitelistedTotal } =
      applyWhitelistAdjustments(checkedMessages, whitelistSet);

    let categorized = categorizeMessages(
      processedMessages,
      settings.thresholds.clean,
      settings.thresholds.low,
      settings.thresholds.confirmed
    );

    if (this.aiConfig.enabled && settings.aiEnabled) {
      // Whitelisted senders are never sent to AI - a human-curated
      // whitelist entry is a stronger trust signal than an AI re-check, and
      // skipping it avoids spending AI budget on mail the mailbox owner
      // already trusts. They still keep whatever tier their
      // (whitelist-adjusted) score actually produced - only non-whitelisted
      // clean/low messages go to AI.
      const nonSpamPartition = partitionByWhitelistFlag(
        categorized.nonSpamMessages
      );
      const lowSpamPartition = partitionByWhitelistFlag(
        categorized.lowSpamMessages
      );

      const aiResults = await this.aiClassificationStep.classify(
        {
          nonSpamMessages: nonSpamPartition.rest,
          lowSpamMessages: lowSpamPartition.rest,
        },
        session
      );

      const escalated = applyAiEscalation(
        {
          ...categorized,
          nonSpamMessages: nonSpamPartition.rest,
          lowSpamMessages: lowSpamPartition.rest,
        },
        aiResults,
        {
          escalateToLowThreshold: settings.aiEscalation.toLowThreshold,
          escalateToHighThreshold: settings.aiEscalation.toHighThreshold,
        }
      );

      categorized = mergeWhitelistedBack(
        escalated,
        nonSpamPartition.whitelisted,
        lowSpamPartition.whitelisted
      );
    }

    const { nonSpamMessages, lowSpamMessages, highSpamMessages } = categorized;
    // Blacklisted messages never went through categorizeMessages - merge
    // them into the confirmed/spam bucket here.
    const spamMessages = [...categorized.spamMessages, ...blacklistedMessages];

    // Process messages with the configured strategy (label/folder)
    await this.disposeCategorized(
      { nonSpamMessages, lowSpamMessages, highSpamMessages },
      session
    );

    await this.dispositionStep.moveConfirmedSpam(spamMessages, session);

    const progress = computeScanProgress(state, messages);

    await writeScannerState(
      imap,
      folders.state,
      {
        last_uid: progress.last_uid,
        last_seen_date: progress.last_seen_date,
        last_checked: progress.last_checked,
        ...(state.uid_validity !== undefined && {
          uid_validity: state.uid_validity,
        }),
      },
      logger
    );

    state.last_uid = progress.last_uid;

    logger.debug(
      {
        folder: folders.inbox,
        processedCount: messages.length,
        spamCount: spamMessages.length,
        lowSpamCount: lowSpamMessages.length,
        highSpamCount: highSpamMessages.length,
        nonSpamCount: nonSpamMessages.length,
        whitelistedCount: whitelistedTotal,
        last_uid: progress.last_uid,
        last_seen_date: progress.last_seen_date,
      },
      'Batch processing completed'
    );

    return {
      lowSpamTotal: lowSpamMessages.length,
      highSpamTotal: highSpamMessages.length,
      nonSpamTotal: nonSpamMessages.length,
      spamTotal: spamMessages.length,
      whitelistedTotal,
    };
  }

  /**
   * Run the inbox scanning workflow for one mailbox session. Orchestrates
   * the complete scanning process: read state, search, batch process,
   * update state.
   * @returns Count of messages fetched and processed, and the resulting
   *   `last_uid`
   */
  async runScan(
    session: MailboxSession
  ): Promise<{ processed: number; last_uid: number }> {
    const { folders, logger } = session;

    try {
      const { state, uids } =
        await this.pendingMessagesStep.locate(session);
      if (uids.length === 0) {
        logger.debug({ folder: folders.inbox }, 'No new messages to process');
        return { processed: 0, last_uid: state.last_uid };
      }

      const lists = await this.senderListLookupStep.load(session);

      let totals: BatchTotals = {
        lowSpamTotal: 0,
        highSpamTotal: 0,
        nonSpamTotal: 0,
        spamTotal: 0,
        whitelistedTotal: 0,
      };

      // Process messages in batches
      const batchSize = this.scanConfig.batchProcessSize;
      for (let i = 0; i < uids.length; i += batchSize) {
        logger.debug(
          {
            from: i,
            to: Math.min(i + batchSize, uids.length),
            total: uids.length,
          },
          'Scanning batch'
        );
        const batchUids = uids.slice(i, i + batchSize);
        const counts = await this.scanBatch(session, batchUids, state, lists);
        totals = sumBatchTotals(totals, counts);
      }

      logger.info(
        { folder: folders.inbox, total: uids.length, ...totals },
        'All scan operations completed'
      );

      return { processed: uids.length, last_uid: state.last_uid };
    } catch (error) {
      logger.error(
        {
          folder: folders.inbox,
          error: error instanceof Error ? error.message : String(error),
        },
        'Error in scan workflow'
      );
      throw error;
    }
  }
}
