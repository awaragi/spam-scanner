import { writeScannerState } from '../lib/clients/state-manager.client.js';
import { newClient, safeLogout } from '../lib/clients/imap.client.js';
import { assertRequiredConfig } from '../lib/core/config.js';

assertRequiredConfig();

let data = '';
process.stdin.on('data', chunk => (data += chunk));
process.stdin.on('end', async () => {
  const state = JSON.parse(data);
  const imap = newClient();

  try {
    await imap.connect();
    await writeScannerState(imap, state);
  } finally {
    await safeLogout(imap);
  }
});
