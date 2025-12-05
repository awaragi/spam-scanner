import pino from 'pino';
import fs from 'fs';
import {config} from './utils/config.js';
import {readScannerState, writeScannerState} from './state-manager.js';
import {count, fetchAllMessages, fetchMessagesByUIDs, moveMessages, open, search, updateLabels} from "./imap-client.js";
import {extractSenders, dateToString} from "./utils/email.js";
import {parseEmail, parseSpamAssassinOutput} from "./utils/email-parser.js";
import {categorizeMessages} from "./utils/spam-classifier.js";
import {spawnAsync} from "./utils/spawn-async.js";

const logger = pino();

// Spam label constants
const USER = config.USER;
const HOME = config.HOME;
const SPAM_LABEL_LOW = config.SPAM_LABEL_LOW;
const SPAM_LABEL_HIGH = config.SPAM_LABEL_HIGH;
const PROCESS_BATCH_SIZE = config.PROCESS_BATCH_SIZE;

/**
 * for learnFromFolder: Process messages with sa-learn
 */
async function processWithSALearn(message, learnCmd, type) {
    const {uid, raw} = message;
    logger.info({uid, type}, 'Learning message');

    let subject = message.envelope.subject;
    try {
        const result = await spawnAsync('sa-learn', ['--max-size=100000000', learnCmd],  raw);

        if (result.code !== 0) {
            throw new Error(`sa-learn failed for message ${uid} with code ${result.code} - ${result.stderr}`);
        }

        const {stdout} = result;
        logger.info({uid, subject, stdout}, 'Message processed with sa-learn');
    } catch (err) {
        // Write raw message to file for debugging
        const logPath = `./failed_message_${uid}_${Date.now()}.txt`;
        fs.writeFileSync(logPath, raw);

        logger.error({uid, subject, error: err.message, logPath}, 'sa-learn process error');
        throw err;
    }
}

async function train(messages, learnCmd, type) {
    if (messages.length === 0) {
        return;
    }

    let processedCount = 0;
    await Promise.all(messages.map(async message => {
        await processWithSALearn(message, learnCmd, type);
        processedCount++;
    }));

    logger.info({type, processedCount}, 'All messages processed with sa-learn');
}

/**
 * for scanInbox: Process messages with SpamAssassin check
 */
async function processWithSpamc(messages) {
    if (messages.length === 0) {
        return [];
    }

    const processedMessages = [];

    await Promise.all(messages.map(async message => {
        const {uid, envelope, raw,} = message;
        const subject = envelope.subject;
        const date = dateToString(envelope.date);

        logger.info({uid, date, subject}, 'Starting spamc check');

        try {
            const args = ['--username', USER, '--max-size', '100000000'];
            logger.debug({args}, 'Running spamc');
            const result = await spawnAsync('spamc', args, raw);

            logger.info({uid, subject, code: result.code}, 'spamc check completed');

            if (result.code !== 0) {
                logger.error({uid, subject, code: result.code}, 'spamc process failed');
                throw new Error(`Unable to process spamc (code = ${result.code}: ${result.stderr}`);
            }

            // parse result
            const { headers, body } = parseEmail(result.stdout);

            // Parse SpamAssassin output
            const { score, required, level, isSpam } = parseSpamAssassinOutput(headers);
            logger.info({uid, score, required, level, isSpam, date, subject,headers}, 'spamc scan results');

            // Add message to processed messages with spam information
            const messageWithSpamInfo = {...message, spamInfo: {score, required, level, isSpam, subject, date}};

            processedMessages.push(messageWithSpamInfo);
        } catch (err) {
            logger.error({uid, error: err.message}, 'spamc process error');
            throw err;
        }
    }));

    logger.info({total: processedMessages.length,}, 'Messages processed with spamc');
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

    const processedMessages = await processWithSpamc(messages);

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

// Update whitelist or blacklist in user preferences file
async function updateList(email, listType) {
    if (!email) {
        logger.warn(`No email address found to ${listType}`);
        return;
    }

    const userPrefPath = `${HOME}/.spamassassin/user_prefs`;
    const entryPrefix = listType === 'whitelist' ? 'whitelist_from' : 'blacklist_from';
    const entry = `${entryPrefix} ${email}`;

    try {
        // Check if file exists
        let content = '';
        try {
            content = fs.readFileSync(userPrefPath, 'utf8');
        } catch (err) {
            // File doesn't exist, create it
            logger.info({path: userPrefPath}, 'Creating user preferences file');
        }

        // Check if entry already exists
        if (content.includes(entry)) {
            logger.info({email}, `Email already in ${listType}`);
            return;
        }

        // Append entry to file
        fs.appendFileSync(userPrefPath, `${content ? '\n' : ''}${entry}`);
        logger.info({email}, `Added email to ${listType}`);
    } catch (err) {
        logger.error({email, error: err.message}, `Failed to update ${listType}`);
        throw err;
    }
}

// Wrapper functions for backward compatibility
async function updateWhitelist(email) {
    return updateList(email, 'whitelist');
}

async function updateBlacklist(email) {
    return updateList(email, 'blacklist');
}

// Learn from folder function for spam and ham
export async function learnFromFolder(imap, type) {
    if (type !== 'spam' && type !== 'ham') {
        throw new Error(`Invalid type: ${type}. Expected 'spam' or 'ham'.`);
    }

    const folder = type === 'spam' ? config.FOLDER_TRAIN_SPAM : config.FOLDER_TRAIN_HAM;
    const learnCmd = type === 'spam' ? '--spam' : '--ham';
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
            await train(batchMessages, learnCmd, type);
            await moveMessages(imap, batchMessages, destFolder);
        }
        logger.info({folder, type, total: messages.length}, 'All operations completed');

    } catch (error) {
        logger.error({folder, type, error: error.message}, 'Error in learnFromFolder process');
        throw error;
    }
}

// Parameterized function for whitelist/blacklist learning
async function learnList(imap, listType) {
    const isWhitelist = listType === 'whitelist';
    const folder = isWhitelist ? config.FOLDER_TRAIN_WHITELIST : config.FOLDER_TRAIN_BLACKLIST;
    const learnCmd = isWhitelist ? '--ham' : '--spam'; // Whitelist as ham, blacklist as spam
    const destFolder = isWhitelist ? config.FOLDER_INBOX : config.FOLDER_SPAM;
    const updateFn = isWhitelist ? updateWhitelist : updateBlacklist;

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
            }, `${listType} batch`);
            const batchMessages = messages.slice(i, i + PROCESS_BATCH_SIZE);

            // Train with appropriate command
            await train(batchMessages, learnCmd, listType);

            // Extract sender email and update list
            for (const message of batchMessages) {
                const emails = extractSenders(message.headers);

                if (emails) {
                    logger.info({emails}, `${isWhitelist ? 'Whitelisting' : 'Blacklisting'} emails`);
                    for (let i = 0; i < emails.length; i++) {
                        await updateFn(emails[i]);
                    }
                }
            }

            // Move messages to destination folder
            await moveMessages(imap, batchMessages, destFolder);
        }
        logger.info({folder, processedCount: messages.length}, `All ${listType} operations completed`);

    } catch (error) {
        logger.error({folder, error: error.message}, `Error in learn${listType} process`);
        throw error;
    }
}

// Wrapper functions for backward compatibility and exports
export async function learnWhitelist(imap) {
    return learnList(imap, 'whitelist');
}

export async function learnBlacklist(imap) {
    return learnList(imap, 'blacklist');
}
