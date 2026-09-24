import { readScannerState } from '../lib/clients/state-manager.client.ts';
import { newClient, safeLogout } from '../lib/clients/imap.client.ts';
import { rootLogger } from '../lib/core/logger.ts';
import { assertRequiredConfig } from '../lib/core/config.ts';

assertRequiredConfig();

const logger = rootLogger.forComponent('read-state');
const imap = newClient();

try {
  await imap.connect();
  const state = await readScannerState(imap);
  console.log(JSON.stringify(state, null, 2));
} catch (err) {
  logger.error(
    { error: err instanceof Error ? err.message : String(err) },
    'Failed to read scanner state'
  );
  process.exit(1);
} finally {
  await safeLogout(imap);
}
