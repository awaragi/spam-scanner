import { runBlacklist } from '../lib/controllers/workflows/sender-list-training.controller.ts';
import { newClient, safeLogout } from '../lib/clients/imap.client.ts';
import { assertRequiredConfig } from '../lib/core/config.ts';

assertRequiredConfig();

const imap = newClient();

try {
  await imap.connect();
  await runBlacklist(imap);
} finally {
  await safeLogout(imap);
}
