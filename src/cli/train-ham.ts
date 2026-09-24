import { runHam } from '../lib/controllers/workflows/train.controller.ts';
import { newClient, safeLogout } from '../lib/clients/imap.client.ts';
import { assertRequiredConfig } from '../lib/core/config.ts';

assertRequiredConfig();

const imap = newClient();

try {
  await imap.connect();
  await runHam(imap);
} finally {
  await safeLogout(imap);
}
