import {newClient} from './lib/imap-client.js';
import {config} from './lib/utils/config.js';
import {rootLogger} from './lib/utils/logger.js';

const mailbox = config.FOLDER_INBOX;

const logger = rootLogger.forComponent('list-all');
const imap = newClient();

let i = 1;
async function fetch(imap, uids) {

    const messages = await imap.fetch({uid: uids.join(',')}, {
        source: true,
        uid: true,
        envelope: true,
        flags: true,
    }, {uid: true});
    for await (const message of messages) {

        const {uid, envelope, flags, flagColor} = message;
        console.log('\n-------------------');
        console.log(`Position ${i++} / ${uids.length}`);
        console.log(`UID: ${uid}`);
        console.log(`Subject: ${envelope.subject || '(no subject)'}`);
        console.log(`From: ${envelope.from?.[0]?.address || 'unknown'}`);
        console.log(`To: ${envelope.to?.map(t => t.address).join(', ') || 'unknown'}`);
        console.log(`Date: ${envelope.date}`);
        console.log(`Flags: ${JSON.stringify(flags)}`);
        console.log(`Flag Color: ${flagColor}`);
        console.log('-------------------');
    }

}
async function listAllEmails() {
    try {
        await imap.connect();
        await imap.mailboxOpen(mailbox);

        const uids = await imap.search({uid: `${1}:*`}, {
            uid: true
        });

        for (let i = 0; i < uids.length; i += 10) {
            const batchUids = uids.slice(i, i + 10);
            await fetch(imap, batchUids);
        }
    } catch (err) {
        logger.error({err}, 'Failed to list emails');
        process.exit(1);
    } finally {
        await imap.logout();
    }
}

await listAllEmails();