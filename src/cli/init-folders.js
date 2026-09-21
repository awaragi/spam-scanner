import { runInit } from '../lib/controllers/workflows/init.controller.js';
import { newClient, safeLogout } from '../lib/clients/imap.client.js';

const imap = newClient();

try {
  await imap.connect();
  await runInit(imap);
} finally {
  await safeLogout(imap);
}
