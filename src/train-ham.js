import { runHam } from './lib/controllers/workflows/train.controller.js';
import { newClient, safeLogout } from './lib/clients/imap.client.js';

const imap = newClient();

try {
  await imap.connect();
  await runHam(imap);
} finally {
  await safeLogout(imap);
}
