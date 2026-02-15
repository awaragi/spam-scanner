import {rootLogger} from './utils/logger.js';
import {config} from './utils/config.js';
import {readScannerState, writeMapState, writeScannerState} from './state-manager.js';
import {count, fetchAllMessages, fetchMessagesByUIDs, moveMessages, open, search, updateLabels} from "./imap-client.js";
import {extractSenders, dateToString} from "./utils/email.js";
import {parseEmail, parseRspamdOutput} from "./utils/email-parser.js";
import {categorizeMessages} from "./utils/spam-classifier.js";
import {checkEmail, learnHam, learnSpam} from "./rspamd-client.js";
import {updateMap} from "./utils/rspamd-maps.js";
import path from 'path';
import fs from 'fs/promises';

const logger = rootLogger.forComponent('engine');

// Spam label constants
const SPAM_LABEL_LOW = config.SPAM_LABEL_LOW;
const SPAM_LABEL_HIGH = config.SPAM_LABEL_HIGH;
const PROCESS_BATCH_SIZE = config.PROCESS_BATCH_SIZE;

/**
 * Process messages with Rspamd learning
 */
async function processWithRspamdLearn(message, learnFn, type) {
    const {uid, raw} = message;
    const messageLogger = logger.forMessage(uid);
    messageLogger.info({type}, 'Learning message with Rspamd');

    let subject = message.envelope.subject;
    try {
        const result = await learnFn(raw);
        messageLogger.info({subject, result}, 'Message processed with Rspamd learn');
    } catch (err) {
        messageLogger.error({subject, error: err.message}, 'Rspamd learn process error');
        throw err;
    }
}

async function train(messages, learnFn, type) {
    if (messages.length === 0) {
        return;
    }

    let processedCount = 0;
    await Promise.all(messages.map(async message => {
        await processWithRspamdLearn(message, learnFn, type);
        processedCount++;
    }));

    logger.info({type, processedCount}, 'All messages processed with Rspamd learn');
}

/**
 * Process messages with Rspamd check
 */
async function processWithRspamd(messages) {
    if (messages.length === 0) {
        return [];
    }

    const processedMessages = [];

    await Promise.all(messages.map(async message => {
        const {uid, envelope, raw,} = message;
        const messageLogger = logger.forMessage(uid);
        const subject = envelope.subject;
        const date = dateToString(envelope.date);

        messageLogger.info({date, subject}, 'Starting Rspamd check');

        try {
            messageLogger.debug('Checking email with Rspamd');
            const result = await checkEmail(raw);

            messageLogger.info({subject, action: result.action, score: result.score}, 'Rspamd check completed');

            // Parse Rspamd output
            const { score, required, level, isSpam } = parseRspamdOutput(result);
            messageLogger.info({score, required, level, isSpam, date, subject}, 'Rspamd scan results');

            // Add message to processed messages with spam information
            const messageWithSpamInfo = {...message, spamInfo: {score, required, level, isSpam, subject, date}};

            processedMessages.push(messageWithSpamInfo);
        } catch (err) {
            messageLogger.error({error: err.message}, 'Rspamd check process error');
            throw err;
        }
    }));

    logger.info({total: processedMessages.length,}, 'Messages processed with Rspamd');
    return processedMessages;
}

export async function scanInbox(imap) {
    let now = new Date().toISOString();
    const defaultState = {
        last_uid: 0,
        last_seen_date: now,
        last_checked: now,
    };
    const state = await readScannerState(imap, defaultState);

    try {
        // Step 1: Open the folder
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

        let lowSpamTotal = 0, highSpamTotal = 0, nonSpamTotal = 0, spamTotal = 0;

        for (let i = 0; i < uids.length; i += PROCESS_BATCH_SIZE) {
            logger.info({
                from: i,
                to: Math.min(i + PROCESS_BATCH_SIZE, uids.length),
                total: uids.length
            }, 'Scanning batch');
            const batchUids = uids.slice(i, i + PROCESS_BATCH_SIZE);
            const counts = await scanMessages(imap, batchUids, state);
            lowSpamTotal += counts.lowSpamTotal;
            highSpamTotal += counts.highSpamTotal;
            nonSpamTotal += counts.nonSpamTotal;
            spamTotal += counts.spamTotal;
        }

        logger.info({folder: config.FOLDER_INBOX, total: uids.length, lowSpamTotal, highSpamTotal, nonSpamTotal, spamTotal}, 'All scan operations completed');
    } catch (error) {
        logger.error({folder: config.FOLDER_INBOX, error: error.message}, 'Error in scanInbox process');
        throw error;
    }
}

async function scanMessages(imap, uids, state) {
    const messages = await fetchMessagesByUIDs(imap, uids);

    const processedMessages = await processWithRspamd(messages);

    // TODO extract headers as a lot of functions just work on headers

    const {lowSpamMessages, highSpamMessages, nonSpamMessages, spamMessages} = categorizeMessages(processedMessages);

    logger.info({count: messages.length}, 'Resetting spam labels');
    await updateLabels(imap, nonSpamMessages, [], [SPAM_LABEL_LOW, SPAM_LABEL_HIGH]);

    logger.info({count: lowSpamMessages.length}, 'Applying Spam:Low label');
    await updateLabels(imap, lowSpamMessages, [SPAM_LABEL_LOW], [SPAM_LABEL_HIGH]);

    logger.info({count: highSpamMessages.length}, 'Applying Spam:High label');
    await updateLabels(imap, highSpamMessages, [SPAM_LABEL_HIGH], [SPAM_LABEL_LOW]);

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
        lowSpamTotal: lowSpamMessages.length, highSpamTotal: highSpamMessages.length, nonSpamTotal: nonSpamMessages.length, spamTotal: spamMessages.length
    };
}

// Learn from folder function for spam and ham
export async function learnFromFolder(imap, type) {
    if (type !== 'spam' && type !== 'ham') {
        throw new Error(`Invalid type: ${type}. Expected 'spam' or 'ham'.`);
    }

    const folder = type === 'spam' ? config.FOLDER_TRAIN_SPAM : config.FOLDER_TRAIN_HAM;
    const learnFn = type === 'spam' ? learnSpam : learnHam;
    const destFolder = type === 'spam' ? config.FOLDER_SPAM : config.FOLDER_INBOX;

    try {
        const box = await open(imap, folder);

        const messageCount = count(box);

        if (messageCount === 0) {
            logger.info({folder}, 'No messages in folder to process');
            return;
        }

        const messages = await fetchAllMessages(imap);

        for (let i = 0; i < messages.length; i += PROCESS_BATCH_SIZE) {
            logger.info({
                from: i,
                to: Math.min(i + PROCESS_BATCH_SIZE, messages.length),
                total: messages.length,
                type,
            }, 'Learn batch');
            const batchMessages = messages.slice(i, i + PROCESS_BATCH_SIZE);
            await train(batchMessages, learnFn, type);
            await moveMessages(imap, batchMessages, destFolder);
        }
        logger.info({folder, type, total: messages.length}, 'All operations completed');

    } catch (error) {
        logger.error({folder, type, error: error.message}, 'Error in learnFromFolder process');
        throw error;
    }
}

/**
 * Learn from whitelist training folder and update map file
 */
export async function learnWhitelist(imap) {
    await learnFromMap(imap, 'whitelist');
}

/**
 * Learn from blacklist training folder and update map file
 */
export async function learnBlacklist(imap) {
    await learnFromMap(imap, 'blacklist');
}

/**
 * Learn from map training folder (whitelist or blacklist)
 * Extracts senders and updates the corresponding map file
 */
async function learnFromMap(imap, type) {
    if (type !== 'whitelist' && type !== 'blacklist') {
        throw new Error(`Invalid map type: ${type}. Expected 'whitelist' or 'blacklist'.`);
    }

    const folder = type === 'whitelist' ? config.FOLDER_TRAIN_WHITELIST : config.FOLDER_TRAIN_BLACKLIST;
    const mapPath = type === 'whitelist' ? config.RSPAMD_WHITELIST_MAP_PATH : config.RSPAMD_BLACKLIST_MAP_PATH;

    // Resolve map path relative to repo root if it's not absolute
    const resolvedMapPath = path.isAbsolute(mapPath)
        ? mapPath
        : path.resolve(process.cwd(), mapPath);

    try {
        const box = await open(imap, folder);
        const messageCount = count(box);

        if (messageCount === 0) {
            logger.info({folder, type}, 'No messages in training folder');
            return;
        }

        const messages = await fetchAllMessages(imap);
        const senders = [];

        // Extract senders from all messages
        for (const message of messages) {
            const {uid, headers} = message;
            const messageLogger = logger.forMessage(uid);
            const messageSenders = extractSenders(headers);

            if (messageSenders.length > 0) {
                senders.push(...messageSenders);
                messageLogger.debug({senders: messageSenders}, `Extracted senders for ${type}`);
            } else {
                messageLogger.debug(`No extractable senders found for ${type}`);
            }
        }

        if (senders.length === 0) {
            logger.info({folder, type}, 'No extractable senders found in training folder');
            return;
        }

        // Update map file with senders
        const result = await updateMap(resolvedMapPath, senders);
        logger.info({folder, type, ...result}, `${type} map updated`);

        let mapContent = null;
        try {
            mapContent = await fs.readFile(resolvedMapPath, 'utf-8');
        } catch (err) {
            if (err.code === 'ENOENT') {
                logger.info({mapPath: resolvedMapPath, type}, 'Map file not found for state backup');
            } else {
                throw err;
            }
        }

        if (mapContent !== null) {
            const mapStateKey = type === 'whitelist'
                ? config.STATE_KEY_WHITELIST_MAP
                : config.STATE_KEY_BLACKLIST_MAP;
            await writeMapState(imap, mapStateKey, mapContent);
            logger.info({folder, type, mapStateKey}, 'Map state backup updated');
        }

        // Move processed messages to destination folder
        const destFolder = type === 'whitelist' ? config.FOLDER_INBOX : config.FOLDER_SPAM;
        await moveMessages(imap, messages, destFolder);
        logger.info({folder, type, destFolder, total: messages.length}, 'Training messages moved');

    } catch (error) {
        logger.error({folder, type, error: error.message}, 'Error in learnFromMap process');
        throw error;
    }
}
