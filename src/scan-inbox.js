import { runScan as scanInbox } from './lib/workflows/scan-workflow.js';
import { newClient, safeLogout } from './lib/clients/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await scanInbox(imap);
} finally {
  await safeLogout(imap);
}
