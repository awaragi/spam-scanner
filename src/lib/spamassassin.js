import {getConfig} from './util.js';
import {readScannerState, writeScannerState} from './state-manager.js';
import {spawn} from 'child_process';
import {
    connect,
    fetchAllMessages,
    fetchMessagesByUID,
    moveMessages,
    openFolderAndCount,
    openInboxAndSearch
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

        messages.forEach(({uid, raw}) => {
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
            return resolve({spamMessages: [], maxUID: 0});
        }

        let completedCount = 0;
        let hasError = false;
        const spamMessages = [];
        let maxUID = 0;

        messages.forEach(({uid, raw}) => {
            logger.info({uid}, 'Starting SpamAssassin check');
            const proc = spawn('spamc');
            proc.stdin.end(raw);
            let output = '';
            proc.stdout.on('data', chunk => output += chunk);

            proc.on('close', (code) => {
                logger.info({uid, code}, 'SpamAssassin check completed');

                if (code !== 0) {
                    logger.error({uid, code}, 'SpamAssassin process failed');
                }

                if (output.includes('X-Spam-Flag: YES')) {
                    logger.info({uid}, 'Detected spam');
                    spamMessages.push({uid, raw});
                }

                maxUID = Math.max(maxUID, uid);
                completedCount++;

                if (completedCount === messages.length) {
                    logger.info({
                        processedCount: completedCount,
                        spamCount: spamMessages.length,
                        maxUID
                    }, 'All messages processed with SpamAssassin');
                    resolve({spamMessages, maxUID});
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
        // Promise 1: Open inbox and search for new messages
        const newUIDs = await openInboxAndSearch(imap, config.FOLDER_INBOX, state.last_uid);

        if (newUIDs.length === 0) {
            logger.info({folder: config.FOLDER_INBOX}, 'No new messages to process');
            imap.end();
            return;
        }

        // Promise 2: Fetch messages by UID with batch limit
        const messages = await fetchMessagesByUID(imap, newUIDs, config.SCAN_BATCH_SIZE);

        // Promise 3: Process messages with SpamAssassin check
        const {spamMessages, maxUID} = await processMessagesWithSpamCheck(messages);

        // Promise 4: Move spam messages to spam folder
        if (spamMessages.length > 0) {
            await moveMessages(imap, spamMessages, config.FOLDER_SPAM);
        }

        // Update scanner state
        const newLastUID = Math.max(state.last_uid, maxUID);
        await writeScannerState({
            last_uid: newLastUID,
            last_seen_date: new Date().toISOString(),
            last_checked: new Date().toISOString()
        });

        logger.info({
            folder: config.FOLDER_INBOX,
            processedCount: messages.length,
            spamCount: spamMessages.length,
            lastUID: newLastUID
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
        // Promise 1: Open folder and get message count
        const messageCount = await openFolderAndCount(imap, folder);

        if (messageCount === 0) {
            logger.info({folder}, 'No messages in folder to process');
            imap.end();
            return;
        }

        // Promise 2: Fetch all messages sequentially
        const messages = await fetchAllMessages(imap);

        // Promise 3: Process messages with sa-learn
        await processMessagesWithSaLearn(messages, learnCmd, type);

        // Promise 4: Move all messages to destination folder
        await moveMessages(imap, messages, destFolder);

        logger.info({folder, type, processedCount: messages.length}, 'All operations completed');

    } catch (error) {
        logger.error({folder, type, error: error.message}, 'Error in learnFromFolder process');
        throw error;
    } finally {
        imap.end();
    }
}