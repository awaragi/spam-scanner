import { runWhitelist } from './lib/workflows/map-workflow.js';
import { newClient, safeLogout } from './lib/clients/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await runWhitelist(imap);
} finally {
  await safeLogout(imap);
}
