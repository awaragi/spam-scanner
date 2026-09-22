import { readScannerState } from '../lib/clients/state-manager.client.js';
import { newClient, safeLogout } from '../lib/clients/imap.client.js';
import { rootLogger } from '../lib/core/logger.js';
import { assertRequiredConfig } from '../lib/core/config.js';

assertRequiredConfig();

const logger = rootLogger.forComponent('read-state');
const imap = newClient();

try {
  await imap.connect();
  const state = await readScannerState(imap);
  console.log(JSON.stringify(state, null, 2));
} catch (err) {
  logger.error({ error: err.message }, 'Failed to read scanner state');
  process.exit(1);
} finally {
  await safeLogout(imap);
}
