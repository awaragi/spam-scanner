import { runWhitelist } from '../lib/controllers/workflows/sender-list-training.controller.js';
import { newClient, safeLogout } from '../lib/clients/imap.client.js';
import { assertRequiredConfig } from '../lib/core/config.js';

assertRequiredConfig();

const imap = newClient();

try {
  await imap.connect();
  await runWhitelist(imap);
} finally {
  await safeLogout(imap);
}
