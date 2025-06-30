import { learnFromFolder } from './lib/spamassassin.js';
import { newClient } from './lib/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await learnFromFolder(imap, 'ham');
} finally {
  await imap.logout();
}
