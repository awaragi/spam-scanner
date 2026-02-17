import { runHam } from './lib/workflows/train-workflow.js';
import { newClient } from './lib/clients/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await runHam(imap);
} finally {
  await imap.logout();
}
