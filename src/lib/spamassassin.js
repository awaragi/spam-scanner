import {getConfig} from './util.js';
import {readScannerState, writeScannerState} from './state-manager.js';
import {spawn} from 'child_process';
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
import pino from 'pino';

const config = getConfig();
const logger = pino();

// Spam label constants
const SPAM_LABEL_LOW = 'Spam:Low';
const SPAM_LABEL_HIGH = 'Spam:High';

const BATCH_SIZE = 5;

/**
 * for learnFromFolder: Process messages with sa-learn
 */
async function processWithSALearn(message, learnCmd, type) {
    const {uid, raw} = message;
    logger.info({uid, type}, 'Learning message');

    return new Promise((resolve, reject) => {
        const proc = spawn('sa-learn', [learnCmd]);
        proc.stdin.write(raw);
        proc.stdin.end();

        proc.on('close', (code) => {
            if (code !== 0) {
                logger.error({uid, code}, 'sa-learn process failed');
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
    for (const message of messages) {
        await processWithSALearn(message, learnCmd, type);
        processedCount++;
        logger.info({processedCount, total: messages.length}, 'Progress');
    }

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
            const proc = spawn('spamc');
            proc.stdin.end(raw);
            let output = '';
            proc.stdout.on('data', chunk => output += chunk);

            proc.on('close', (code) => {
                logger.info({uid, code}, 'SpamAssassin check completed');

                if (code !== 0) {
                    logger.error({uid, code}, 'SpamAssassin process failed');
                }

                const subjectMatch = raw.match(/Subject: (.*)/);
                const scoreMatch = output.match(/X-Spam-Status:.*score=([0-9.-]+)/);
                const levelMatch = output.match(/X-Spam-Level:\s+(\*+)/);
                const spamFlagMatch = output.match(/X-Spam-Flag:\s+(\w+)/);
                const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;
                const level = levelMatch ? levelMatch[1].length : 0;
                const isSpam = !!spamFlagMatch && spamFlagMatch[1] === 'YES';
                const subject = subjectMatch ? subjectMatch[1].trim() : '';
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

// Refactored scanInbox function
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

        for (let i = 0; i < uids.length; i += BATCH_SIZE) {
            logger.info({i, total: uids.length}, 'Processing batch');
            const batchUids = uids.slice(i, i + BATCH_SIZE);
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

// Refactored learnFromFolder function
export async function learnFromFolder(type) {
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

        await train(messages, learnCmd, type);

        await moveMessages(imap, messages, destFolder);

        logger.info({folder, type, processedCount: messages.length}, 'All operations completed');

    } catch (error) {
        logger.error({folder, type, error: error.message}, 'Error in learnFromFolder process');
        throw error;
    } finally {
        imap.end();
    }
}
