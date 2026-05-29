import { runInit } from './lib/workflows/init-workflow.js';
import { runSpam, runHam } from './lib/workflows/train-workflow.js';
import { runWhitelist, runBlacklist } from './lib/workflows/map-workflow.js';
import { runScan as runScan } from './lib/workflows/scan-workflow.js';
import { runIdle } from './lib/workflows/idle-workflow.js';
import { newClient } from './lib/clients/imap-client.js';
import { config } from './lib/utils/config.js';
import { rootLogger } from './lib/utils/logger.js';

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
    logger.error(
      { step: workflowFn.name, duration, error: err.message },
      'Step failed'
    );
  } finally {
    await imap.logout();
    if (!stepError) {
      const duration = Date.now() - start;
      logger.info({ step: workflowFn.name, duration }, 'Step completed');
    }
  }
  if (stepError) throw stepError;
  return result;
}

const scanInterval = parseInt(process.env.SCAN_INTERVAL || '-1', 10);

logger.info(
  {
    host: config.IMAP_HOST,
    user: config.IMAP_USER,
    intervalSeconds: scanInterval,
  },
  'Starting orchestrator'
);

await runStep(runInit);

let failures = 0;
do {
  try {
    // Run training steps
    await runStep(runSpam);
    await runStep(runHam);
    await runStep(runWhitelist);
    await runStep(runBlacklist);

    // Scan drain loop: repeat until no new messages remain
    let scanResult;
    do {
      scanResult = await runStep(runScan);
    } while (scanResult && scanResult.processed > 0);

    // Wait condition depends on mode
    if (scanInterval < 0) {
      // Single-run: exit after one cycle
      logger.info('Cycle complete, single-run mode');
      break;
    } else if (scanInterval === 0) {
      // IDLE mode: wait for IMAP EXISTS notification
      logger.info('Waiting for new messages (IDLE)');
      await runStep(runIdle);
      logger.info('IDLE wakeup received, restarting scan cycle');
    } else {
      // Poll mode: wait for next interval
      logger.info(
        { intervalSeconds: scanInterval },
        'Cycle complete, waiting for next poll'
      );
      await new Promise(resolve => setTimeout(resolve, scanInterval * 1000));
    }

    failures = 0;
  } catch (err) {
    failures++;
    if (failures >= config.MAX_RETRIES) {
      logger.error({ failures }, 'MAX_RETRIES reached, exiting');
      process.exit(1);
    }
    const backoff = Math.min(Math.pow(2, failures) * 1000, 60000);
    logger.error(
      { failures, backoffMs: backoff, error: err.message },
      'Cycle failed, retrying with backoff'
    );
    await new Promise(resolve => setTimeout(resolve, backoff));
  }
} while (true);
