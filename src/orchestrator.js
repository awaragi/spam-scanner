import {runInit} from './lib/workflows/init-workflow.js';
import {runSpam, runHam} from './lib/workflows/train-workflow.js';
import {runWhitelist, runBlacklist} from './lib/workflows/map-workflow.js';
import {runScan as runScan} from './lib/workflows/scan-workflow.js';
import {runIdle} from './lib/workflows/idle-workflow.js';
import {newClient} from './lib/clients/imap-client.js';
import {config} from './lib/utils/config.js';
import {rootLogger} from './lib/utils/logger.js';

const logger = rootLogger.forComponent('orchestrator');

if (!config.IMAP_HOST) {
  logger.error('IMAP_HOST environment variable is not set');
  process.exit(1);
}

if (!config.IMAP_USER) {
  logger.error('IMAP_USER environment variable is not set');
  process.exit(1);
}

async function runStep(workflowFn) {
  const start = Date.now();
  const imap = newClient();
  let result;
  let stepError;
  try {
    await imap.connect();
    result = await workflowFn(imap);
  } catch (err) {
    stepError = err;
    const duration = Date.now() - start;
    logger.error({step: workflowFn.name, duration, error: err.message}, 'Step failed');
  } finally {
    await imap.logout();
    const duration = Date.now() - start;
    logger.info({step: workflowFn.name, duration}, 'Step completed');
  }
  if (stepError) throw stepError;
  return result;
}

const scanInterval = parseInt(process.env.SCAN_INTERVAL || '-1', 10);

logger.info({host: config.IMAP_HOST, user: config.IMAP_USER, intervalSeconds: scanInterval}, 'Starting orchestrator');

await runStep(runInit);

if (scanInterval === 0) {
  // IDLE mode: event-driven scan cycles triggered by IMAP EXISTS notifications
  logger.info('Entering IDLE mode');
  let failures = 0;
  while (true) {
    try {
      // Run training steps once per wakeup
      await runStep(runSpam);
      await runStep(runHam);
      await runStep(runWhitelist);
      await runStep(runBlacklist);

      // Scan drain loop: repeat until no new messages remain
      let scanResult;
      do {
        scanResult = await runStep(runScan);
      } while (scanResult && scanResult.processed > 0);

      // Wait for server notification
      await runStep(runIdle);

      failures = 0;
      logger.info('IDLE cycle complete, re-entering IDLE');
    } catch (err) {
      failures++;
      if (failures >= config.IDLE_MAX_RETRIES) {
        logger.error({failures}, 'IDLE_MAX_RETRIES reached, exiting');
        process.exit(1);
      }
      const backoff = Math.min(Math.pow(2, failures) * 1000, 60000);
      logger.error({failures, backoffMs: backoff, error: err.message}, 'IDLE cycle failed, retrying with backoff');
      await new Promise(resolve => setTimeout(resolve, backoff));
    }
  }
} else {
  // Single-run or poll mode
  do {
    await runStep(runSpam);
    await runStep(runHam);
    await runStep(runWhitelist);
    await runStep(runBlacklist);
    await runStep(runScan);
    if (scanInterval < 0) {
      logger.info('Cycle complete, single-run mode');
      break;
    }
    logger.info({intervalSeconds: scanInterval}, 'Cycle complete, sleeping');
    await new Promise(resolve => setTimeout(resolve, (scanInterval * 1000)));
  } while (true);
}
