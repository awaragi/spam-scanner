import { runSpam } from '../lib/controllers/workflows/train.controller.js';
import { newClient, safeLogout } from '../lib/clients/imap.client.js';
import { assertRequiredConfig } from '../lib/core/config.js';

assertRequiredConfig();

const imap = newClient();

try {
  await imap.connect();
  await runSpam(imap);
} finally {
  await safeLogout(imap);
}
