import { deleteScannerState } from '../lib/clients/state-manager.client.ts';
import { newClient, safeLogout } from '../lib/clients/imap.client.ts';
import { assertRequiredConfig } from '../lib/core/config.ts';

assertRequiredConfig();

const imap = newClient();

try {
  await imap.connect();
  await deleteScannerState(imap);
} finally {
  await safeLogout(imap);
}
