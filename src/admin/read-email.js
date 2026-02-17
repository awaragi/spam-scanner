import {newClient, processMessage} from '../lib/clients/imap-client.js';
import {config} from '../lib/utils/config.js';
import {rootLogger} from '../lib/utils/logger.js';
import path from 'path';
import fs from 'fs/promises';

const HOME = config.HOME;
const mailbox = config.FOLDER_INBOX;

// MESSAGE_ID has priority
const UID = 2201; // Replace with actual UID
const MESSAGE_ID = '<83181f5681bd89f619b2b1e48210f391@eidiant.com>'; // Replace with actual Message-ID

const logger = rootLogger.forComponent('read-email');
const imap = newClient();

async function fetchAndSaveEmail(uid, messageId) {
    try {
        await imap.connect();
        await imap.getMailboxLock(mailbox);

        const searchCriteria = messageId
            ? {header: {'Message-ID': messageId}}
            : {uid: String(uid)};
        const messages = await imap.fetch(searchCriteria, {
            uid: true,
            source: true,
            envelope: true,
            bodyStructure: true,
        }, {uid: true});

        for await (const _message of messages) {
            const message = processMessage(_message);
            const uid = message.uid;
            const subject = message.envelope.subject || 'no-subject';
            const sanitizedSubject = subject.replace(/[^a-z0-9]/gi, '-');
            const filename = `Test-Email-${uid}-${sanitizedSubject}.eml`;
            const filepath = path.join(HOME, filename);

            await fs.writeFile(filepath, message.raw);
            logger.info(`Message saved to ${filepath}`);
        }
    } catch (err) {
        logger.error({err}, 'Failed to fetch and save email');
        process.exit(1);
    } finally {
        await imap.logout();
    }
}

await fetchAndSaveEmail(UID, MESSAGE_ID);