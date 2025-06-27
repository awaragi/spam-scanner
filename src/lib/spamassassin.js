import {getConfig} from './util.js';
import {readScannerState, writeScannerState} from './state-manager.js';
import {spawn} from 'child_process';
import {
    connect,
    open,
    count,
    search,
    fetchAllMessages,
    fetchMessagesByUIDs,
    moveMessages
} from "./imap-client.js";
import pino from 'pino';

const config = getConfig();
const logger = pino();

/**
 * for learnFromFolder: Process messages with sa-learn
 */
function processMessagesWithSaLearn(messages, learnCmd, type) {
    return new Promise((resolve, reject) => {
        if (messages.length === 0) {
            return resolve();
        }

        let completedCount = 0;
        let hasError = false;

        messages.forEach(({uid, raw, attrs}) => {
            logger.info({uid, type}, 'Learning message');
            const proc = spawn('sa-learn', [learnCmd]);
            proc.stdin.write(raw);
            proc.stdin.end();

            proc.on('close', (code) => {
                if (code !== 0 && !hasError) {
                    hasError = true;
                    logger.error({uid, code}, 'sa-learn process failed');
                    return reject(new Error(`sa-learn failed for message ${uid} with code ${code}`));
                }

                completedCount++;
                logger.info({uid, completedCount, total: messages.length}, 'Message learned');

                if (completedCount === messages.length) {
                    logger.info({processedCount: completedCount}, 'All messages processed with sa-learn');
                    resolve();
                }
            });

            proc.on('error', (err) => {
                if (!hasError) {
                    hasError = true;
                    logger.error({uid, error: err.message}, 'sa-learn process error');
                    reject(err);
                }
            });
        });
    });
}

/**
 * for scanInbox: Process messages with SpamAssassin check
 */
function processMessagesWithSpamCheck(messages) {
    return new Promise((resolve, reject) => {
        if (messages.length === 0) {
            return resolve([]);
        }

        let completedCount = 0;
        let hasError = false;
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


                if (isSpam) {
                    logger.info({uid}, 'Detected spam');
                    spamMessages.push({uid, raw});
                }


                completedCount++;

                if (completedCount === messages.length) {
                    logger.info({
                        processedCount: completedCount,
                        spamCount: spamMessages.length
                    }, 'All messages processed with SpamAssassin');
                    resolve(spamMessages);
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
        const newUIDs = await search(imap, state.last_uid);

        if (newUIDs.length === 0) {
            logger.info({folder: config.FOLDER_INBOX}, 'No new messages to process');
            imap.end();
            return;
        }

        const limitedUIDs = newUIDs.slice(0, config.SCAN_BATCH_SIZE);

        const messages = await fetchMessagesByUIDs(imap, limitedUIDs);

        const spamMessages = await processMessagesWithSpamCheck(messages);

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

        logger.info({
            folder: config.FOLDER_INBOX,
            processedCount: messages.length,
            spamCount: spamMessages.length,
            last_uid,
            last_seen_date
        }, 'Inbox scan completed');

    } catch (error) {
        logger.error({folder: config.FOLDER_INBOX, error: error.message}, 'Error in scanInbox process');
        throw error;
    } finally {
        imap.end();
    }
}

// Refactored learnFromFolder function
export async function learnFromFolder(type) {
    const folder = type === 'spam' ? config.FOLDER_TRAIN_SPAM : config.FOLDER_TRAIN_HAM;
    const learnCmd = type === 'spam' ? '--spam' : '--ham';
    const destFolder = type === 'spam' ? config.FOLDER_SPAM : config.FOLDER_INBOX;

    const imap = connect();

    try {
        // Step 1: Open folder
        const box = await open(imap, folder);

        // Step 2: Get message count
        const messageCount = count(box);

        if (messageCount === 0) {
            logger.info({folder}, 'No messages in folder to process');
            imap.end();
            return;
        }

        // Step 3: Fetch all messages sequentially
        const messages = await fetchAllMessages(imap);

        // Step 4: Process messages with sa-learn
        await processMessagesWithSaLearn(messages, learnCmd, type);

        // Step 5: Move all messages to destination folder
        await moveMessages(imap, messages, destFolder);

        logger.info({folder, type, processedCount: messages.length}, 'All operations completed');

    } catch (error) {
        logger.error({folder, type, error: error.message}, 'Error in learnFromFolder process');
        throw error;
    } finally {
        imap.end();
    }
}