import {rootLogger} from '../utils/logger.js';
import {config} from '../utils/config.js';
import {readScannerState, writeScannerState} from '../state-manager.js';
import {open, search, fetchMessagesByUIDs, moveMessages} from '../clients/imap-client.js';
import {processWithRspamd} from '../services/message-service.js';
import {categorizeMessages} from '../utils/spam-classifier.js';
import {createProcessor} from '../processors/base-processor.js';
import {dateToString} from '../utils/email.js';

const logger = rootLogger.forComponent('scan-workflow');

const PROCESS_BATCH_SIZE = config.PROCESS_BATCH_SIZE;

/**
 * Scan and process a batch of messages
 * @param {Object} imap - ImapFlow client
 * @param {Array} uids - Array of message UIDs to process
 * @param {Object} state - Current scanner state
 * @param {Object} processor - Message processor instance
 * @returns {Promise<Object>} - Counts of processed messages by category
 */
async function scanBatch(imap, uids, state, processor) {
  const messages = await fetchMessagesByUIDs(imap, uids);

  const processedMessages = await processWithRspamd(messages);

  const {lowSpamMessages, highSpamMessages, nonSpamMessages, spamMessages} = categorizeMessages(processedMessages);

  // Process messages with the configured strategy (label/folder/color)
  await processor.process(imap, {nonSpamMessages, lowSpamMessages, highSpamMessages});

  // Move spam messages to spam folder
  logger.info({count: spamMessages.length}, 'Moving spam messages to spam folder');
  await moveMessages(imap, spamMessages, config.FOLDER_SPAM);

  // Calculate last_uid from all processed messages
  let last_uid = Math.max(...messages.map(msg => msg.uid));
  last_uid = Math.max(state.last_uid, last_uid);

  const last_seen_date = messages.reduce((maxDate, message) => {
    const date = dateToString(message.envelope.date);
    if (!date) return maxDate;
    return (date.localeCompare(maxDate) > 0 ? date : maxDate);
  }, new Date(0).toISOString());
  const last_checked = new Date().toISOString();

  await writeScannerState(imap, {
    last_uid,
    last_seen_date,
    last_checked
  });

  state.last_uid = last_uid;

  logger.info({
    folder: config.FOLDER_INBOX,
    processedCount: messages.length,
    spamCount: spamMessages.length,
    lowSpamCount: lowSpamMessages.length,
    highSpamCount: highSpamMessages.length,
    nonSpamCount: nonSpamMessages.length,
    last_uid,
    last_seen_date
  }, 'Batch processing completed');

  return {
    lowSpamTotal: lowSpamMessages.length,
    highSpamTotal: highSpamMessages.length,
    nonSpamTotal: nonSpamMessages.length,
    spamTotal: spamMessages.length
  };
}

/**
 * Run inbox scanning workflow
 * Orchestrates the complete scanning process: read state, search, batch process, update state
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<void>}
 */
export async function run(imap) {
  const now = new Date().toISOString();
  const defaultState = {
    last_uid: 0,
    last_seen_date: now,
    last_checked: now,
  };
  const state = await readScannerState(imap, defaultState);

  try {
    // Step 1: Open the inbox folder
    await open(imap, config.FOLDER_INBOX);

    // Step 2: Search for new messages
    let query = {uid: `${state.last_uid + 1}:*`};
    if (!config.SCAN_READ) {
      query.seen = false;
    }
    const newUIDs = await search(imap, query);
    if (newUIDs.length === 0) {
      logger.info({folder: config.FOLDER_INBOX}, 'No new messages to process');
      return;
    }

    const uids = newUIDs.slice(0, config.SCAN_BATCH_SIZE);

    // Create processor based on configuration
    const processingMode = config.SPAM_PROCESSING_MODE || 'label';
    const processor = await createProcessor(processingMode);

    let lowSpamTotal = 0, highSpamTotal = 0, nonSpamTotal = 0, spamTotal = 0;

    // Step 3: Process messages in batches
    for (let i = 0; i < uids.length; i += PROCESS_BATCH_SIZE) {
      logger.info({
        from: i,
        to: Math.min(i + PROCESS_BATCH_SIZE, uids.length),
        total: uids.length
      }, 'Scanning batch');
      const batchUids = uids.slice(i, i + PROCESS_BATCH_SIZE);
      const counts = await scanBatch(imap, batchUids, state, processor);
      lowSpamTotal += counts.lowSpamTotal;
      highSpamTotal += counts.highSpamTotal;
      nonSpamTotal += counts.nonSpamTotal;
      spamTotal += counts.spamTotal;
    }

    logger.info({
      folder: config.FOLDER_INBOX,
      total: uids.length,
      lowSpamTotal,
      highSpamTotal,
      nonSpamTotal,
      spamTotal
    }, 'All scan operations completed');
  } catch (error) {
    logger.error({folder: config.FOLDER_INBOX, error: error.message}, 'Error in scan workflow');
    throw error;
  }
}
