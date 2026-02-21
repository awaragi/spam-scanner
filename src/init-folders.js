import {runInit} from './lib/workflows/init-workflow.js';
import {newClient} from './lib/clients/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await runInit(imap);
} finally {
  await imap.logout();
}
