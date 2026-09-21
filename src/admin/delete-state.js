import { deleteScannerState } from '../lib/clients/state-manager.client.js';
import { newClient, safeLogout } from '../lib/clients/imap.client.js';

const imap = newClient();

try {
  await imap.connect();
  await deleteScannerState(imap);
} finally {
  await safeLogout(imap);
}
