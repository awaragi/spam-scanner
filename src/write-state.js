import { writeScannerState } from './lib/state-manager.js';
import { newClient } from './lib/imap-client.js';

let data = '';
process.stdin.on('data', chunk => data += chunk);
process.stdin.on('end', async () => {
  const state = JSON.parse(data);
  const imap = newClient();

  try {
    await imap.connect();
    await writeScannerState(imap, state);
  } finally {
    await imap.logout();
  }
});
