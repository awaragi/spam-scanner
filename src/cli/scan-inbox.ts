import { runScan as scanInbox } from '../lib/controllers/workflows/scan.controller.ts';
import { newClient, safeLogout } from '../lib/clients/imap.client.ts';
import { assertRequiredConfig } from '../lib/core/config.ts';

assertRequiredConfig();

const imap = newClient();

try {
  await imap.connect();
  await scanInbox(imap);
} finally {
  await safeLogout(imap);
}
