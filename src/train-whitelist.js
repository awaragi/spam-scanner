import { runWhitelist } from './lib/workflows/map-workflow.js';
import { newClient } from './lib/clients/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await runWhitelist(imap);
} finally {
  await imap.logout();
}
