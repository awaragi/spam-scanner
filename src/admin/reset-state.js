import { newClient, safeLogout } from '../lib/clients/imap.client.js';
import { writeScannerState } from '../lib/clients/state-manager.client.js';

const now = new Date();

const imap = newClient();

try {
  await imap.connect();
  await writeScannerState(imap, {
    last_uid: 0,
    last_seen_date: now.toISOString(),
    last_checked: now.toISOString(),
  });
} finally {
  await safeLogout(imap);
}
