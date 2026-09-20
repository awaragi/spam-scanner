import { runInit } from './lib/workflows/init-workflow.js';
import { newClient, safeLogout } from './lib/clients/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await runInit(imap);
} finally {
  await safeLogout(imap);
}
