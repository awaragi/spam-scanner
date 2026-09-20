import { deleteScannerState } from '../lib/state-manager.js';
import { newClient, safeLogout } from '../lib/clients/imap-client.js';

const imap = newClient();

try {
  await imap.connect();
  await deleteScannerState(imap);
} finally {
  await safeLogout(imap);
}
