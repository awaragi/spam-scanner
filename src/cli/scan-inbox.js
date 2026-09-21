import { runScan as scanInbox } from '../lib/controllers/workflows/scan.controller.js';
import { newClient, safeLogout } from '../lib/clients/imap.client.js';
import { assertRequiredConfig } from '../lib/core/config.js';

assertRequiredConfig();

const imap = newClient();

try {
  await imap.connect();
  await scanInbox(imap);
} finally {
  await safeLogout(imap);
}
