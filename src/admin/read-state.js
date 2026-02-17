import { readScannerState } from '../lib/state-manager.js';
import { newClient } from '../lib/clients/imap-client.js';
import { rootLogger } from '../lib/utils/logger.js';

const logger = rootLogger.forComponent('read-state');
const imap = newClient();

try {
  await imap.connect();
  const state = await readScannerState(imap);
  console.log(JSON.stringify(state, null, 2));
} catch (err) {
  logger.error('Failed to read scanner state:', err.message);
  process.exit(1);
} finally {
  await imap.logout();
}
