import { writeScannerState } from './lib/state-manager.js';
import { newClient } from './lib/imap-client.js';

let data = '';
// process.stdin.on('data', chunk => data += chunk);
// process.stdin.on('end', async () => {
  data = `
  {
    "last_uid": 3,
    "last_seen_date": "2022-01-01",
    "last_checked": "2022-01-01"
  }`;
  const state = JSON.parse(data);
  const imap = newClient();

  try {
    await imap.connect();
    await writeScannerState(imap, state);
  } finally {
    await imap.logout();
  }
