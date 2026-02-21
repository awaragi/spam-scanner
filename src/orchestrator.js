import {runInit} from './lib/workflows/init-workflow.js';
import {runSpam, runHam} from './lib/workflows/train-workflow.js';
import {runWhitelist, runBlacklist} from './lib/workflows/map-workflow.js';
import {run as runScan} from './lib/workflows/scan-workflow.js';
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
  try {
    await imap.connect();
    await workflowFn(imap);
  } finally {
    await imap.logout();
    const duration = Date.now() - start;
    logger.info({step: workflowFn.name, duration}, 'Step completed');
  }
}

const scanInterval = parseInt(process.env.SCAN_INTERVAL || '-1', 10);

logger.info({host: config.IMAP_HOST, user: config.IMAP_USER, intervalSeconds: scanInterval}, 'Starting orchestrator');

await runStep(runInit);

do {
  await runStep(runSpam);
  await runStep(runHam);
  await runStep(runWhitelist);
  await runStep(runBlacklist);
  await runStep(runScan);
  if (scanInterval <= 0) {
    logger.info('Cycle complete, single-run mode');
    break;
  }
  logger.info({intervalSeconds: scanInterval}, 'Cycle complete, sleeping');
  await new Promise(resolve => setTimeout(resolve, (scanInterval * 1000)));
} while (true);
