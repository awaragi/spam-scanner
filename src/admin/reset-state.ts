import { newClient, safeLogout } from '../lib/clients/imap.client.ts';
import { writeScannerState } from '../lib/clients/state-manager.client.ts';
import { assertRequiredConfig } from '../lib/core/config.ts';

assertRequiredConfig();

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
