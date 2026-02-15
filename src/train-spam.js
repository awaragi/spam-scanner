import { learnFromFolder } from './lib/engine.js';
import { newClient } from './lib/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await learnFromFolder(imap, 'spam');
} finally {
  await imap.logout();
}
