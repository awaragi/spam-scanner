import {newClient, processMessage} from './lib/imap-client.js';
import {config} from './lib/utils/config.js';
import pino from 'pino';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const mailbox = config.FOLDER_INBOX;
const UID = 2201; // Replace with actual UID

const logger = pino();
const imap = newClient();

async function fetchAndSaveEmail(uid) {
    try {
        await imap.connect();
        await imap.getMailboxLock(mailbox);

        const messages = await imap.fetch({uid: String(uid)}, {
            source: true,
            envelope: true
        }, {uid: true});

        for await (const _message of messages) {
            const message = processMessage(_message);
            const subject = message.envelope.subject || 'no-subject';
            const sanitizedSubject = subject.replace(/[^a-z0-9]/gi, '-');
            const filename = `${uid}-${sanitizedSubject}.eml`;
            const filepath = path.join(os.homedir(), filename);

            await fs.writeFile(filepath, message.source);
            logger.info(`Message saved to ${filepath}`);
        }
    } catch (err) {
        logger.error({err}, 'Failed to fetch and save email');
        process.exit(1);
    } finally {
        await imap.logout();
    }
}

await fetchAndSaveEmail(UID);