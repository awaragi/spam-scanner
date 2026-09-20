import { randomUUID } from 'crypto';
import { rootLogger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import {
  readScannerState,
  writeScannerState,
  readMapState,
} from '../state-manager.js';
import {
  open,
  search,
  fetchMessagesByUIDs,
  moveMessages,
  appendMessage,
} from '../clients/imap-client.js';
import { processWithRspamd } from '../services/message-service.js';
import { learnHam } from '../clients/rspamd-client.js';
import {
  categorizeMessages,
  applyAiEscalation,
} from '../utils/spam-classifier.js';
import { classifyWithAi } from '../services/ai-classification-service.js';
import { markNotified } from '../services/ai-failure-tracker.js';
import { createProcessor } from '../processors/base-processor.js';
import { dateToString } from '../utils/email.js';
import { senderAddressOf } from '../utils/sender-lists.js';

const logger = rootLogger.forComponent('scan-workflow');

const PROCESS_BATCH_SIZE = config.PROCESS_BATCH_SIZE;

// Distinct from both FOLDER_INBOX's owner domain and "localhost" - rspamd penalizes
// a Message-ID host that matches the From/To domain (MID_RHS_MATCH_*) as well as one
// that isn't a dotted hostname at all (MID_RHS_NOT_FQDN); an unrelated dotted host
// avoids both.
const ALERT_MESSAGE_ID_DOMAIN = 'spam-scanner.internal';

/**
 * Builds a plain-text RFC822 message alerting the mailbox owner that AI
 * classification has been failing repeatedly for the same reason. Includes a
 * Message-ID (rspamd's MISSING_MID otherwise scores this a few points toward
 * "low spam", since a locally-appended message has no originating MTA to add one).
 * @param {{reason: string, count: number, lastError: string, lastAt: string}} alert
 * @returns {string}
 */
function buildAiFailureAlertEmail(alert) {
  const { reason, count, lastError, lastAt } = alert;
  return `From: Spam Scanner <scanner@localhost>
To: ${config.IMAP_USER}
Subject: Spam Scanner: AI classification failing repeatedly (${reason})
Message-ID: <${randomUUID()}@${ALERT_MESSAGE_ID_DOMAIN}>
Date: ${new Date().toUTCString()}
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0

The AI classification safety net has failed ${count} times in a row with the same reason.

Reason: ${reason}
Consecutive failures: ${count}
Last error: ${lastError}
Last failure at: ${lastAt}

This is a one-time notice for this ongoing issue - it will not repeat until AI
classification succeeds again. Check AI_BASE_URL/AI_API_KEY/AI_MODEL and the
provider's status if this is unexpected.`;
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
 */
async function postAiFailureAlert(imap, alert) {
  if (!alert) {
    return;
  }
  const raw = buildAiFailureAlertEmail(alert);
  try {
    await appendMessage(imap, config.FOLDER_INBOX, raw);
    markNotified(alert.reason);
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
 * Splits a list of already-categorized messages by whether their sender is
 * whitelisted. Used only to decide AI eligibility - it never changes which
 * tier a message is in (see `spam-classifier.js`'s `categorizeMessages`).
 * @param {Array} messages
 * @returns {{whitelisted: Array, rest: Array}}
 */
function partitionByWhitelist(messages) {
  const whitelisted = [];
  const rest = [];
  for (const message of messages) {
    (message.spamInfo?.isWhitelisted ? whitelisted : rest).push(message);
  }
  return { whitelisted, rest };
}

/**
 * Scan and process a batch of messages
 * @param {Object} imap - ImapFlow client
 * @param {Array} uids - Array of message UIDs to process
 * @param {Object} state - Current scanner state
 * @param {Object} processor - Message processor instance
 * @param {{whitelistSet: Set<string>, blacklistSet: Set<string>}} lists - Sender lists loaded once per `runScan` call
 * @returns {Promise<Object>} - Counts of processed messages by category
 */
async function scanBatch(imap, uids, state, processor, lists) {
  const { whitelistSet, blacklistSet } = lists;
  const messages = await fetchMessagesByUIDs(imap, uids);

  // Blacklist check precedes the rspamd call entirely (see the `sender-lists`
  // capability) - a blacklisted sender is confirmed spam unconditionally,
  // with no content scoring and no AI review. Everyone else proceeds to
  // rspamd as before.
  const blacklistedMessages = [];
  const remainingMessages = [];
  for (const message of messages) {
    const sender = senderAddressOf(message);
    if (blacklistSet.has(sender)) {
      logger
        .forMessage(message.uid)
        .debug(
          { sender },
          'Blacklist match - classified confirmed, skipping rspamd and AI'
        );
      blacklistedMessages.push(message);
    } else {
      remainingMessages.push(message);
    }
  }

  const processedMessages = await processWithRspamd(
    remainingMessages,
    whitelistSet
  );
  const whitelistedTotal = processedMessages.filter(
    m => m.spamInfo?.isWhitelisted
  ).length;

  let categorized = categorizeMessages(
    processedMessages,
    config.SPAM_CLEAN_THRESHOLD,
    config.SPAM_LOW_THRESHOLD,
    config.SPAM_CONFIRMED_THRESHOLD
  );

  if (config.AI_ENABLED) {
    // Whitelisted senders are never sent to AI - a human-curated whitelist
    // entry is a stronger trust signal than an AI re-check, and skipping it
    // avoids spending AI budget on mail the mailbox owner already trusts.
    // They still keep whatever tier their (whitelist-adjusted) score
    // actually produced - only non-whitelisted clean/low messages go to AI.
    const nonSpamPartition = partitionByWhitelist(categorized.nonSpamMessages);
    const lowSpamPartition = partitionByWhitelist(categorized.lowSpamMessages);

    const aiResults = await classifyWithAi({
      nonSpamMessages: nonSpamPartition.rest,
      lowSpamMessages: lowSpamPartition.rest,
    });
    await postAiFailureAlert(imap, aiResults.aiFailureAlert);

    const escalated = applyAiEscalation(
      {
        ...categorized,
        nonSpamMessages: nonSpamPartition.rest,
        lowSpamMessages: lowSpamPartition.rest,
      },
      aiResults,
      {
        escalateToLowThreshold: config.AI_ESCALATE_TO_LOW_THRESHOLD,
        escalateToHighThreshold: config.AI_ESCALATE_TO_HIGH_THRESHOLD,
      }
    );

    categorized = {
      ...escalated,
      nonSpamMessages: [
        ...escalated.nonSpamMessages,
        ...nonSpamPartition.whitelisted,
      ],
      lowSpamMessages: [
        ...escalated.lowSpamMessages,
        ...lowSpamPartition.whitelisted,
      ],
    };
  }

  const { nonSpamMessages, lowSpamMessages, highSpamMessages } = categorized;
  // Blacklisted messages never went through categorizeMessages - merge them
  // into the confirmed/spam bucket here.
  const spamMessages = [...categorized.spamMessages, ...blacklistedMessages];

  // Process messages with the configured strategy (label/folder/color)
  await processor.process(imap, {
    nonSpamMessages,
    lowSpamMessages,
    highSpamMessages,
  });

  // Move spam messages to spam folder
  logger.debug(
    { count: spamMessages.length },
    'Moving spam messages to spam folder'
  );
  await moveMessages(imap, spamMessages, config.FOLDER_SPAM);

  // Calculate last_uid from all processed messages
  let last_uid = Math.max(...messages.map(msg => msg.uid));
  last_uid = Math.max(state.last_uid, last_uid);

  const last_seen_date = messages.reduce((maxDate, message) => {
    const date = dateToString(message.envelope.date);
    if (!date) return maxDate;
    return date.localeCompare(maxDate) > 0 ? date : maxDate;
  }, new Date(0).toISOString());
  const last_checked = new Date().toISOString();

  await writeScannerState(imap, {
    last_uid,
    last_seen_date,
    last_checked,
    ...(state.uid_validity !== undefined && {
      uid_validity: state.uid_validity,
    }),
  });

  state.last_uid = last_uid;

  logger.debug(
    {
      folder: config.FOLDER_INBOX,
      processedCount: messages.length,
      spamCount: spamMessages.length,
      lowSpamCount: lowSpamMessages.length,
      highSpamCount: highSpamMessages.length,
      nonSpamCount: nonSpamMessages.length,
      whitelistedCount: whitelistedTotal,
      last_uid,
      last_seen_date,
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
 * Run inbox scanning workflow
 * Orchestrates the complete scanning process: read state, search, batch process, update state
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<{processed: number, last_uid: number}>} - Count of messages fetched and processed, and the resulting last_uid
 */
export async function runScan(imap) {
  const now = new Date().toISOString();
  const defaultState = {
    last_uid: 0,
    last_seen_date: now,
    last_checked: now,
  };
  const state = await readScannerState(imap, defaultState, config.FOLDER_INBOX);

  try {
    // Step 1: Open the inbox folder
    const mailbox = await open(imap, config.FOLDER_INBOX);

    // UIDVALIDITY identifies a specific numbering "epoch" for this mailbox's
    // UIDs; it changes if the server ever rebuilds its index or the account
    // is migrated. A last_uid stored under a stale UIDVALIDITY is meaningless
    // under the new one (it could even skip all new mail), so a mismatch is
    // treated the same as "no state" - reset to new-mail-only rather than
    // either trusting the stale UID or rescanning the whole inbox.
    const currentUidValidity = mailbox.uidValidity?.toString();
    let uidValidityChanged = false;
    if (
      state.uid_validity !== undefined &&
      currentUidValidity !== undefined &&
      state.uid_validity !== currentUidValidity
    ) {
      const resetUid = mailbox.uidNext > 1 ? mailbox.uidNext - 1 : 0;
      logger.warn(
        {
          folder: config.FOLDER_INBOX,
          previousUidValidity: state.uid_validity,
          currentUidValidity,
          previousLastUid: state.last_uid,
          resetLastUid: resetUid,
        },
        'UIDVALIDITY changed - resetting to new-mail-only instead of trusting stale UIDs'
      );
      state.last_uid = resetUid;
      uidValidityChanged = true;
    }
    if (currentUidValidity !== undefined) {
      state.uid_validity = currentUidValidity;
    }

    // Step 2: Search for new messages
    let query = { uid: `${state.last_uid + 1}:*` };
    if (!config.SCAN_READ) {
      query.seen = false;
    }
    // Filter out UIDs <= last_uid: IMAP returns the max UID when the range start
    // exceeds the mailbox max (e.g. "7385:*" becomes "7384:7385"), causing the
    // last processed email to always be re-scanned.
    const newUIDs = (await search(imap, query)).filter(
      uid => uid > state.last_uid
    );
    if (newUIDs.length === 0) {
      // Persist a UIDVALIDITY reset even with nothing new to process, so the
      // next cycle doesn't re-detect the same "mismatch" and re-warn forever.
      if (uidValidityChanged) {
        await writeScannerState(imap, {
          last_uid: state.last_uid,
          last_seen_date: state.last_seen_date,
          last_checked: new Date().toISOString(),
          uid_validity: state.uid_validity,
        });
      }
      logger.debug(
        { folder: config.FOLDER_INBOX },
        'No new messages to process'
      );
      return { processed: 0, last_uid: state.last_uid };
    }

    const uids = newUIDs.slice(0, config.SCAN_BATCH_SIZE);

    // Create processor based on configuration
    const processingMode = config.SPAM_PROCESSING_MODE || 'label';
    const processor = await createProcessor(processingMode);

    // Load whitelist/blacklist once per runScan call, not once per batch -
    // the underlying IMAP-backed state doesn't change mid-scan (see the
    // `sender-lists` capability). Sequential, not Promise.all: each read
    // switches the connection's selected mailbox and restores it afterward,
    // which isn't safe to run concurrently on a single IMAP connection.
    const whitelistEntries = await readMapState(
      imap,
      config.STATE_KEY_WHITELIST_MAP
    );
    const blacklistEntries = await readMapState(
      imap,
      config.STATE_KEY_BLACKLIST_MAP
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
    for (let i = 0; i < uids.length; i += PROCESS_BATCH_SIZE) {
      logger.debug(
        {
          from: i,
          to: Math.min(i + PROCESS_BATCH_SIZE, uids.length),
          total: uids.length,
        },
        'Scanning batch'
      );
      const batchUids = uids.slice(i, i + PROCESS_BATCH_SIZE);
      const counts = await scanBatch(imap, batchUids, state, processor, lists);
      lowSpamTotal += counts.lowSpamTotal;
      highSpamTotal += counts.highSpamTotal;
      nonSpamTotal += counts.nonSpamTotal;
      spamTotal += counts.spamTotal;
      whitelistedTotal += counts.whitelistedTotal;
    }

    logger.info(
      {
        folder: config.FOLDER_INBOX,
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
      { folder: config.FOLDER_INBOX, error: error.message },
      'Error in scan workflow'
    );
    throw error;
  }
}
