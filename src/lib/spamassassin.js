import pino from 'pino';
import {mimeWordDecode} from 'emailjs-mime-codec';
import {spawn} from 'child_process';
import fs from 'fs';
import {config} from './utils/config.js';
import {readScannerState, writeScannerState} from './state-manager.js';
import {
    connect,
    count,
    fetchAllMessages,
    fetchMessagesByUIDs,
    moveMessages,
    open,
    search,
    updateLabels
} from "./imap-client.js";
import {homedir} from "node:os";
import {extractHeaders, extractSenders} from "./utils/email.js";

const logger = pino();

// Spam label constants
const SPAM_LABEL_LOW = config.SPAM_LABEL_LOW;
const SPAM_LABEL_HIGH = config.SPAM_LABEL_HIGH;
const PROCESS_BATCH_SIZE = config.PROCESS_BATCH_SIZE;

/**
 * for learnFromFolder: Process messages with sa-learn
 */
async function processWithSALearn(message, learnCmd, type) {
    const {uid, raw} = message;
    logger.info({uid, type}, 'Learning message');

    return new Promise((resolve, reject) => {
        const proc = spawn('sa-learn', ['--max-size=100000000', learnCmd]);
        proc.stdin.write(raw);
        proc.stdin.end();

        proc.on('close', (code) => {
            if (code !== 0) {
                // Write raw message to file for debugging
                const logPath = `./failed_message_${uid}_${Date.now()}.txt`;
                fs.writeFileSync(logPath, raw);

                logger.error({uid, code, logPath}, 'sa-learn process failed');
                return reject(new Error(`sa-learn failed for message ${uid} with code ${code}`));
            }
            logger.info({uid}, 'Message learned');
            resolve();
        });

        proc.on('error', (err) => {
            logger.error({uid, error: err.message}, 'sa-learn process error');
            reject(err);
        });
    });
}

async function train(messages, learnCmd, type) {
    if (messages.length === 0) {
        return;
    }

    let processedCount = 0;
    await Promise.all(messages.map(async message => {
        await processWithSALearn(message, learnCmd, type);
        processedCount++;
        logger.debug({processedCount, total: messages.length}, 'Progress');
    }));

    logger.info({processedCount}, 'All messages processed with sa-learn');
}

/**
 * for scanInbox: Process messages with SpamAssassin check
 */
function process(messages) {
    return new Promise((resolve, reject) => {
        if (messages.length === 0) {
            return resolve([]);
        }

        let completedCount = 0;
        let hasError = false;
        const processedMessages = [];
        const spamMessages = [];

        messages.forEach(({uid, raw, attrs}) => {
            logger.info({uid, attrs}, 'Starting SpamAssassin check');
            const proc = spawn('spamc', ['--max-size', '100000000']);
            proc.stdin.end(raw);
            let spamcOutput = '';
            proc.stdout.on('data', chunk => spamcOutput += chunk);

            proc.on('close', (code) => {
                logger.info({uid, code}, 'SpamAssassin check completed');

                if (code !== 0) {
                    logger.error({uid, code}, 'SpamAssassin process failed');
                }

                // TODO use extract headers
                const subjectMatch = raw.match(/^Subject:\s+(.*)$/m);
                const scoreMatch = spamcOutput.match(/^X-Spam-Status:.*score=([0-9.-]+)/);
                const levelMatch = spamcOutput.match(/^X-Spam-Level:\s+(\*+)/);
                const spamFlagMatch = spamcOutput.match(/^X-Spam-Flag:\s+(\w+)/);

                const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;
                const level = levelMatch ? levelMatch[1].length : 0;
                const isSpam = !!spamFlagMatch && spamFlagMatch[1] === 'YES';
                const subject = subjectMatch ? mimeWordDecode(subjectMatch[1].trim()) : '';
                const date = attrs.date ? attrs.date.toISOString() : '';

                logger.info({
                    uid,
                    score,
                    level,
                    isSpam,
                    date,
                    subject,
                }, 'SpamAssassin scan results');

                // Add message to processed messages with spam information
                const messageWithSpamInfo = {
                    uid,
                    raw,
                    attrs,
                    spamInfo: {
                        score,
                        level,
                        isSpam,
                        subject,
                        date
                    }
                };

                processedMessages.push(messageWithSpamInfo);

                if (isSpam) {
                    logger.info({uid}, 'Detected spam');
                    spamMessages.push(messageWithSpamInfo);
                }

                completedCount++;

                if (completedCount === messages.length) {
                    logger.info({
                        processedCount: completedCount,
                        spamCount: spamMessages.length
                    }, 'All messages processed with SpamAssassin');
                    resolve(processedMessages);
                }
            });

            proc.on('error', (err) => {
                if (!hasError) {
                    hasError = true;
                    logger.error({uid, error: err.message}, 'SpamAssassin process error');
                    reject(err);
                }
            });
        });
    });
}

export async function scanInbox() {
    const state = await readScannerState();
    const imap = connect();

    try {
        // Step 1: Open the folder
        await open(imap, config.FOLDER_INBOX);

        // Step 2: Search for new messages
        const newUIDs = await search(imap, state.last_uid, config.SCAN_READ);

        if (newUIDs.length === 0) {
            logger.info({folder: config.FOLDER_INBOX}, 'No new messages to process');
            imap.end();
            return;
        }

        const uids = newUIDs.slice(0, config.SCAN_BATCH_SIZE);

        for (let i = 0; i < uids.length; i += PROCESS_BATCH_SIZE) {
            logger.info({
                from: i,
                to: Math.min(i + PROCESS_BATCH_SIZE, uids.length),
                total: uids.length
            }, 'Scanning batch');
            const batchUids = uids.slice(i, i + PROCESS_BATCH_SIZE);
            await scanMessages(imap, batchUids, state);
        }

    } catch (error) {
        logger.error({folder: config.FOLDER_INBOX, error: error.message}, 'Error in scanInbox process');
        throw error;
    } finally {
        imap.end();
    }
}

async function scanMessages(imap, uids, state) {
    const messages = await fetchMessagesByUIDs(imap, uids);

    const processedMessages = await process(messages);

    const {lowSpamMessages, highSpamMessages, nonSpamMessages, spamMessages} = categorize(processedMessages);

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

    const last_seen_date = messages.reduce((maxDate, msg) => {
        const date = new Date(msg.raw.match(/Date: (.*)/)[1]);
        return maxDate ? (date > maxDate ? date : maxDate) : date;
    }, null);
    const last_checked = new Date().toISOString();

    await writeScannerState({
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
}

/**
 * Helper function to categorize messages based on spam score
 * @param {Array} messages - Array of messages with spam information
 * @returns {Object} - Object with categorized messages
 */
function categorize(messages) {
    const lowSpamMessages = [];
    const highSpamMessages = [];
    const nonSpamMessages = [];
    const spamMessages = [];

    messages.forEach(message => {
        if (message.spamInfo.isSpam) {
            spamMessages.push(message);
        } else if (message.spamInfo.score === null || message.spamInfo.score < 0.0) {
            nonSpamMessages.push(message);
        } else if (message.spamInfo.score < 2.5) {
            lowSpamMessages.push(message);
        } else {
            // default
            highSpamMessages.push(message);
        }
    });

    return {
        lowSpamMessages,
        highSpamMessages,
        nonSpamMessages,
        spamMessages,
    };
}

// Extract sender email from raw message
function extractEmails(raw) {
    return extractSenders(extractHeaders(raw));
}

// Update whitelist in user preferences file
async function updateWhitelist(email) {
    if (!email) {
        logger.warn('No email address found to whitelist');
        return;
    }

    const userPrefPath = `${homedir()}/.spamassassin/user_prefs`;
    const whitelistEntry = `whitelist_from ${email}`;

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
        if (content.includes(whitelistEntry)) {
            logger.info({email}, 'Email already in whitelist');
            return;
        }

        // Append entry to file
        fs.appendFileSync(userPrefPath, `${content ? '\n' : ''}${whitelistEntry}`);
        logger.info({email}, 'Added email to whitelist');
    } catch (err) {
        logger.error({email, error: err.message}, 'Failed to update whitelist');
        throw err;
    }
}

// Learn from folder function for spam and ham
export async function learnFromFolder(type) {
    if (type !== 'spam' && type !== 'ham') {
        throw new Error(`Invalid type: ${type}. Expected 'spam' or 'ham'.`);
    }

    const folder = type === 'spam' ? config.FOLDER_TRAIN_SPAM : config.FOLDER_TRAIN_HAM;
    const learnCmd = type === 'spam' ? '--spam' : '--ham';
    const destFolder = type === 'spam' ? config.FOLDER_SPAM : config.FOLDER_INBOX;

    const imap = connect();

    try {
        const box = await open(imap, folder);

        const messageCount = count(box);

        if (messageCount === 0) {
            logger.info({folder}, 'No messages in folder to process');
            imap.end();
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
        logger.info({folder, type, processedCount: messages.length}, 'All operations completed');

    } catch (error) {
        logger.error({folder, type, error: error.message}, 'Error in learnFromFolder process');
        throw error;
    } finally {
        imap.end();
    }
}

// Separate function for whitelist learning
export async function learnWhitelist() {
    const folder = config.FOLDER_TRAIN_WHITELIST;
    const learnCmd = '--ham'; // Whitelist messages are treated as ham for SpamAssassin
    const destFolder = config.FOLDER_INBOX;

    const imap = connect();

    try {
        const box = await open(imap, folder);

        const messageCount = count(box);

        if (messageCount === 0) {
            logger.info({folder}, 'No messages in folder to process');
            imap.end();
            return;
        }

        const messages = await fetchAllMessages(imap);

        for (let i = 0; i < messages.length; i += PROCESS_BATCH_SIZE) {
            logger.info({
                from: i,
                to: Math.min(i + PROCESS_BATCH_SIZE, messages.length),
                total: messages.length,
            }, 'Whitelist batch');
            const batchMessages = messages.slice(i, i + PROCESS_BATCH_SIZE);

            // Train as ham
            await train(batchMessages, learnCmd, 'whitelist');

            // Extract sender email and update whitelist
            for (const message of batchMessages) {
                const emails = extractEmails(message.raw);
                
                if (emails) {
                    logger.info({emails}, 'Whitelisting emails');
                    for (let i = 0; i < emails.length; i++) {
                        await updateWhitelist(emails[i]);
                    }
                }
            }

            // Move messages to inbox
            await moveMessages(imap, batchMessages, destFolder);
        }
        logger.info({folder, processedCount: messages.length}, 'All whitelist operations completed');

    } catch (error) {
        logger.error({folder, error: error.message}, 'Error in learnWhitelist process');
        throw error;
    } finally {
        imap.end();
    }
}
