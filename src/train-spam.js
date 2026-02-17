import { runSpam } from './lib/workflows/train-workflow.js';
import { newClient } from './lib/clients/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await runSpam(imap);
} finally {
  await imap.logout();
}
