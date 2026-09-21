import { rootLogger } from '../../core/logger.js';
import { writeScannerState } from '../../clients/state-manager.client.js';
import { fetchMessagesByUIDs } from '../../clients/imap.client.js';
import { processWithRspamd } from '../steps/rspamd-check.step.js';
import {
  categorizeMessages,
  applyAiEscalation,
  applyWhitelistAdjustments,
  partitionByWhitelistFlag,
  mergeWhitelistedBack,
} from '../../services/spam-classifier.service.js';
import { partitionBySender } from '../../services/sender-lists.service.js';
import {
  computeScanProgress,
  sumBatchTotals,
} from '../../services/scan-progress.service.js';
import { classifyWithAi } from '../steps/ai-classification.step.js';
import { postAiFailureAlert } from '../steps/ai-failure-alert.step.js';
import { applyLabels } from '../steps/label-apply.step.js';
import { moveToFolders } from '../steps/folder-move.step.js';
import { locatePendingMessages } from '../steps/pending-messages.step.js';
import { loadSenderLists } from '../steps/sender-list-lookup.step.js';
import { moveConfirmedSpam } from '../steps/spam-move.step.js';
import { createDefaultContext } from '../../core/context.js';

const logger = rootLogger.forComponent('scan-controller');

/**
 * Resolves the processing strategy for a categorized batch. Ordinary
 * controller-level wiring, not a hidden business rule - this is where
 * SPAM_PROCESSING_MODE's mode switch (and its 'label' fallback / unknown-mode
 * throw, both formerly embedded in the retired base-processor.js) now lives.
 * @param {string} mode
 * @returns {(imap: Object, categorized: Object, ctx: Object) => Promise<void>}
 */
function resolveProcessFn(mode) {
  switch (mode || 'label') {
    case 'label':
      return applyLabels;
    case 'folder':
      return moveToFolders;
    default:
      throw new Error(
        `Unknown processing mode: ${mode}. Expected 'label' or 'folder'`
      );
  }
}

/**
 * Scan and process a batch of messages.
 * @param {Object} imap - ImapFlow client
 * @param {Array} uids - Array of message UIDs to process
 * @param {Object} state - Current scanner state (mutated: state.last_uid advances)
 * @param {(imap: Object, categorized: Object, ctx: Object) => Promise<void>} processFn - resolved processing strategy
 * @param {{whitelistSet: Set<string>, blacklistSet: Set<string>}} lists - Sender lists loaded once per `runScan` call
 * @param {Object} ctx
 * @returns {Promise<Object>} - Counts of processed messages by category
 */
async function scanBatch(imap, uids, state, processFn, lists, ctx) {
  const { config: cfg } = ctx;
  const { whitelistSet, blacklistSet } = lists;
  const messages = await fetchMessagesByUIDs(imap, uids);

  // Blacklist check precedes the rspamd call entirely (see the `sender-lists`
  // capability) - a blacklisted sender is confirmed spam unconditionally,
  // with no content scoring and no AI review. Everyone else proceeds to
  // rspamd as before.
  const { matched: blacklistedMessages, rest: remainingMessages } =
    partitionBySender(messages, blacklistSet);

  const checkedMessages = await processWithRspamd(remainingMessages, ctx);
  const { messages: processedMessages, whitelistedTotal } =
    applyWhitelistAdjustments(checkedMessages, whitelistSet);

  let categorized = categorizeMessages(
    processedMessages,
    cfg.SPAM_CLEAN_THRESHOLD,
    cfg.SPAM_LOW_THRESHOLD,
    cfg.SPAM_CONFIRMED_THRESHOLD
  );

  if (cfg.AI_ENABLED) {
    // Whitelisted senders are never sent to AI - a human-curated whitelist
    // entry is a stronger trust signal than an AI re-check, and skipping it
    // avoids spending AI budget on mail the mailbox owner already trusts.
    // They still keep whatever tier their (whitelist-adjusted) score
    // actually produced - only non-whitelisted clean/low messages go to AI.
    const nonSpamPartition = partitionByWhitelistFlag(
      categorized.nonSpamMessages
    );
    const lowSpamPartition = partitionByWhitelistFlag(
      categorized.lowSpamMessages
    );

    const aiResults = await classifyWithAi(
      {
        nonSpamMessages: nonSpamPartition.rest,
        lowSpamMessages: lowSpamPartition.rest,
      },
      ctx
    );
    await postAiFailureAlert(imap, aiResults.aiFailureAlert, ctx);

    const escalated = applyAiEscalation(
      {
        ...categorized,
        nonSpamMessages: nonSpamPartition.rest,
        lowSpamMessages: lowSpamPartition.rest,
      },
      aiResults,
      {
        escalateToLowThreshold: cfg.AI_ESCALATE_TO_LOW_THRESHOLD,
        escalateToHighThreshold: cfg.AI_ESCALATE_TO_HIGH_THRESHOLD,
      }
    );

    categorized = mergeWhitelistedBack(
      escalated,
      nonSpamPartition.whitelisted,
      lowSpamPartition.whitelisted
    );
  }

  const { nonSpamMessages, lowSpamMessages, highSpamMessages } = categorized;
  // Blacklisted messages never went through categorizeMessages - merge them
  // into the confirmed/spam bucket here.
  const spamMessages = [...categorized.spamMessages, ...blacklistedMessages];

  // Process messages with the configured strategy (label/folder)
  await processFn(
    imap,
    { nonSpamMessages, lowSpamMessages, highSpamMessages },
    ctx
  );

  await moveConfirmedSpam(imap, spamMessages, ctx);

  const progress = computeScanProgress(state, messages);

  await writeScannerState(imap, {
    last_uid: progress.last_uid,
    last_seen_date: progress.last_seen_date,
    last_checked: progress.last_checked,
    ...(state.uid_validity !== undefined && {
      uid_validity: state.uid_validity,
    }),
  });

  state.last_uid = progress.last_uid;

  logger.debug(
    {
      folder: cfg.FOLDER_INBOX,
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
 * Run inbox scanning workflow.
 * Orchestrates the complete scanning process: read state, search, batch process, update state.
 * @param {Object} imap - ImapFlow client
 * @param {Object} [ctx]
 * @returns {Promise<{processed: number, last_uid: number}>} - Count of messages fetched and processed, and the resulting last_uid
 */
export async function runScan(imap, ctx = createDefaultContext()) {
  const { config: cfg } = ctx;

  try {
    const { state, uids } = await locatePendingMessages(imap, ctx);
    if (uids.length === 0) {
      logger.debug({ folder: cfg.FOLDER_INBOX }, 'No new messages to process');
      return { processed: 0, last_uid: state.last_uid };
    }

    // Resolve the processing strategy based on configuration
    const processFn = resolveProcessFn(cfg.SPAM_PROCESSING_MODE);

    const lists = await loadSenderLists(imap, ctx);

    let totals = {
      lowSpamTotal: 0,
      highSpamTotal: 0,
      nonSpamTotal: 0,
      spamTotal: 0,
      whitelistedTotal: 0,
    };

    // Process messages in batches
    for (let i = 0; i < uids.length; i += cfg.PROCESS_BATCH_SIZE) {
      logger.debug(
        {
          from: i,
          to: Math.min(i + cfg.PROCESS_BATCH_SIZE, uids.length),
          total: uids.length,
        },
        'Scanning batch'
      );
      const batchUids = uids.slice(i, i + cfg.PROCESS_BATCH_SIZE);
      const counts = await scanBatch(
        imap,
        batchUids,
        state,
        processFn,
        lists,
        ctx
      );
      totals = sumBatchTotals(totals, counts);
    }

    logger.info(
      { folder: cfg.FOLDER_INBOX, total: uids.length, ...totals },
      'All scan operations completed'
    );

    return { processed: uids.length, last_uid: state.last_uid };
  } catch (error) {
    logger.error(
      { folder: cfg.FOLDER_INBOX, error: error.message },
      'Error in scan workflow'
    );
    throw error;
  }
}
