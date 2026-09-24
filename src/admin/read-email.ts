import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import {
  newClient,
  processMessage,
  safeLogout,
} from '../lib/clients/imap.client.ts';
import { config, assertRequiredConfig } from '../lib/core/config.ts';
import { rootLogger } from '../lib/core/logger.ts';
import path from 'path';
import fs from 'fs/promises';

assertRequiredConfig();

const HOME = config.HOME;
const mailbox = config.FOLDER_INBOX;

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 --uid <uid> | --message-id <message-id>')
  .option('uid', {
    type: 'number',
    describe: 'UID of the message to fetch',
  })
  .option('message-id', {
    type: 'string',
    describe: 'Message-ID of the message to fetch (takes priority over --uid)',
  })
  .check(argv => {
    if (!argv.uid && !argv.messageId) {
      throw new Error('Provide either --uid or --message-id');
    }
    return true;
  })
  .strict()
  .help().argv;

const UID = argv.uid;
const MESSAGE_ID = argv.messageId;

const logger = rootLogger.forComponent('read-email');
const imap = newClient();

async function fetchAndSaveEmail(uid, messageId) {
  try {
    await imap.connect();
    await imap.getMailboxLock(mailbox);

    const searchCriteria = messageId
      ? { header: { 'Message-ID': messageId } }
      : { uid: String(uid) };
    const messages = await imap.fetch(
      searchCriteria,
      {
        uid: true,
        source: true,
        envelope: true,
        bodyStructure: true,
      },
      { uid: true }
    );

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
    logger.error({ err }, 'Failed to fetch and save email');
    process.exit(1);
  } finally {
    await safeLogout(imap);
  }
}

await fetchAndSaveEmail(UID, MESSAGE_ID);
