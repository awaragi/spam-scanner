import { learnWhitelist } from './lib/spamassassin.js';
import { newClient } from './lib/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await learnWhitelist(imap);
} finally {
  await imap.logout();
}
