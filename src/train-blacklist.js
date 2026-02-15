import { learnBlacklist } from './lib/engine.js';
import { newClient } from './lib/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await learnBlacklist(imap);
} finally {
  await imap.logout();
}
