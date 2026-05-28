import { runIdle } from './lib/workflows/idle-workflow.js';
import { newClient } from './lib/clients/imap-client.js';
import { rootLogger } from './lib/utils/logger.js';

const logger = rootLogger.forComponent('idle');

logger.info('Starting IDLE monitor');

let cycle = 0;
while (true) {
  cycle++;
  const imap = newClient();
  try {
    logger.info({ cycle }, 'Connecting to IMAP');
    await imap.connect();
    logger.info({ cycle }, 'Entering IDLE — waiting for EXISTS notification');
    await runIdle(imap);
    logger.info({ cycle }, 'IDLE resolved — new message detected or timeout, restarting');
  } catch (err) {
    logger.error({ cycle, error: err.message }, 'IDLE cycle error, retrying in 5s');
    await new Promise(resolve => setTimeout(resolve, 5000));
  } finally {
    try {
      await imap.logout();
    } catch (_) {
      // ignore logout errors
    }
  }
}
