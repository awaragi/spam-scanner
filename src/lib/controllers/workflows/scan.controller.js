import { rootLogger } from '../../utils/logger.js';
import {
  readScannerState,
  writeScannerState,
  readMapState,
} from '../../clients/state-manager.client.js';
import {
  open,
  search,
  fetchMessagesByUIDs,
  moveMessages,
  appendMessage,
} from '../../clients/imap.client.js';
import { learnHam } from '../../clients/rspamd.client.js';
import { processWithRspamd } from '../steps/rspamd-check.step.js';
import {
  categorizeMessages,
  applyAiEscalation,
  partitionByWhitelistFlag,
  mergeWhitelistedBack,
} from '../../services/spam-classifier.service.js';
import { partitionBySender } from '../../services/sender-lists.service.js';
import {
  computeScanProgress,
  computeUidValidityReset,
  buildScanQuery,
} from '../../services/scan-progress.service.js';
import { buildAiFailureAlertEmail } from '../../services/alert-email.service.js';
import { classifyWithAi } from '../steps/ai-classification.step.js';
import { applyLabels } from '../steps/label-apply.step.js';
import { moveToFolders } from '../steps/folder-move.step.js';
import { createDefaultContext } from '../../config/context.js';

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
 * @param {Object} ctx
 */
async function postAiFailureAlert(imap, alert, ctx) {
  if (!alert) {
    return;
  }
  const raw = buildAiFailureAlertEmail(alert, ctx.config.IMAP_USER);
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

  const processedMessages = await processWithRspamd(
    remainingMessages,
    whitelistSet,
    ctx
  );
  const whitelistedTotal = processedMessages.filter(
    m => m.spamInfo?.isWhitelisted
  ).length;

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

  // Move spam messages to spam folder
  logger.debug(
    { count: spamMessages.length },
    'Moving spam messages to spam folder'
  );
  await moveMessages(imap, spamMessages, cfg.FOLDER_SPAM);

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
  const now = new Date().toISOString();
  const defaultState = {
    last_uid: 0,
    last_seen_date: now,
    last_checked: now,
  };
  const state = await readScannerState(imap, defaultState, cfg.FOLDER_INBOX);

  try {
    // Step 1: Open the inbox folder
    const mailbox = await open(imap, cfg.FOLDER_INBOX);

    // UIDVALIDITY identifies a specific numbering "epoch" for this mailbox's
    // UIDs; a mismatch is treated the same as "no state" - reset to
    // new-mail-only rather than either trusting the stale UID or rescanning
    // the whole inbox.
    const uidReset = computeUidValidityReset(state, mailbox);
    if (uidReset.changed) {
      logger.warn(
        {
          folder: cfg.FOLDER_INBOX,
          previousUidValidity: uidReset.previousUidValidity,
          currentUidValidity: uidReset.currentUidValidity,
          previousLastUid: state.last_uid,
          resetLastUid: uidReset.state.last_uid,
        },
        'UIDVALIDITY changed - resetting to new-mail-only instead of trusting stale UIDs'
      );
    }
    Object.assign(state, uidReset.state);

    // Step 2: Search for new messages
    const query = buildScanQuery(state, cfg.SCAN_READ);
    // Filter out UIDs <= last_uid: IMAP returns the max UID when the range start
    // exceeds the mailbox max (e.g. "7385:*" becomes "7384:7385"), causing the
    // last processed email to always be re-scanned.
    const newUIDs = (await search(imap, query)).filter(
      uid => uid > state.last_uid
    );
    if (newUIDs.length === 0) {
      // Persist a UIDVALIDITY reset even with nothing new to process, so the
      // next cycle doesn't re-detect the same "mismatch" and re-warn forever.
      if (uidReset.changed) {
        await writeScannerState(imap, {
          last_uid: state.last_uid,
          last_seen_date: state.last_seen_date,
          last_checked: new Date().toISOString(),
          uid_validity: state.uid_validity,
        });
      }
      logger.debug({ folder: cfg.FOLDER_INBOX }, 'No new messages to process');
      return { processed: 0, last_uid: state.last_uid };
    }

    const uids = newUIDs.slice(0, cfg.SCAN_BATCH_SIZE);

    // Resolve the processing strategy based on configuration
    const processFn = resolveProcessFn(cfg.SPAM_PROCESSING_MODE);

    // Load whitelist/blacklist once per runScan call, not once per batch -
    // the underlying IMAP-backed state doesn't change mid-scan (see the
    // `sender-lists` capability). Sequential, not Promise.all: each read
    // switches the connection's selected mailbox and restores it afterward,
    // which isn't safe to run concurrently on a single IMAP connection.
    const whitelistEntries = await readMapState(
      imap,
      cfg.STATE_KEY_WHITELIST_MAP
    );
    const blacklistEntries = await readMapState(
      imap,
      cfg.STATE_KEY_BLACKLIST_MAP
    );
    const lists = {
      whitelistSet: new Set(whitelistEntries),
      blacklistSet: new Set(blacklistEntries),
    };

    let lowSpamTotal = 0,
      highSpamTotal = 0,
      nonSpamTotal = 0,
      spamTotal = 0,
      whitelistedTotal = 0;

    // Step 3: Process messages in batches
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
      lowSpamTotal += counts.lowSpamTotal;
      highSpamTotal += counts.highSpamTotal;
      nonSpamTotal += counts.nonSpamTotal;
      spamTotal += counts.spamTotal;
      whitelistedTotal += counts.whitelistedTotal;
    }

    logger.info(
      {
        folder: cfg.FOLDER_INBOX,
        total: uids.length,
        lowSpamTotal,
        highSpamTotal,
        nonSpamTotal,
        spamTotal,
        whitelistedTotal,
      },
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
