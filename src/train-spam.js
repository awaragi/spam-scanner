import { runSpam } from './lib/workflows/train-workflow.js';
import { newClient, safeLogout } from './lib/clients/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await runSpam(imap);
} finally {
  await safeLogout(imap);
}
