import { runInit } from '../lib/controllers/workflows/init.controller.ts';
import { newClient, safeLogout } from '../lib/clients/imap.client.ts';
import { assertRequiredConfig } from '../lib/core/config.ts';

assertRequiredConfig();

const imap = newClient();

try {
  await imap.connect();
  await runInit(imap);
} finally {
  await safeLogout(imap);
}
