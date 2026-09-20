import { setTimeout as delay } from 'timers/promises';
import { runInit } from '../lib/controllers/workflows/init.controller.js';
import {
  runSpam,
  runHam,
} from '../lib/controllers/workflows/train.controller.js';
import {
  runWhitelist,
  runBlacklist,
} from '../lib/controllers/workflows/sender-list-training.controller.js';
import { runScan } from '../lib/controllers/workflows/scan.controller.js';
import { runIdle } from '../lib/controllers/workflows/idle.controller.js';
import { newClient, safeLogout } from '../lib/clients/imap.client.js';
import { config } from '../lib/core/config.js';
import { rootLogger } from '../lib/core/logger.js';
import { createDefaultContext } from '../lib/core/context.js';

const logger = rootLogger.forComponent('orchestrator');

// Set by the SIGTERM/SIGINT handlers below; checked between steps so a
// `docker stop` finishes the in-flight batch and exits cleanly instead of
// being killed mid-write after the grace period.
let stopping = false;
const shutdownController = new AbortController();

function requestShutdown(signal) {
  if (stopping) return;
  stopping = true;
  logger.info(
    { signal },
    'Shutdown requested, finishing current step and exiting'
  );
  shutdownController.abort();
}

process.on('SIGTERM', () => requestShutdown('SIGTERM'));
process.on('SIGINT', () => requestShutdown('SIGINT'));

/**
 * A setTimeout-style sleep that resolves early (rather than rejecting) if
 * shutdown is requested while waiting, so callers can just check `stopping`
 * afterwards instead of handling an abort-flavoured rejection.
 * @param {number} ms
 * @returns {Promise<void>}
 */
async function interruptibleSleep(ms) {
  try {
    await delay(ms, undefined, { signal: shutdownController.signal });
  } catch (err) {
    if (err.name !== 'AbortError') throw err;
  }
}

if (!config.IMAP_HOST) {
  logger.error('IMAP_HOST environment variable is not set');
  process.exit(1);
}

if (!config.IMAP_USER) {
  logger.error('IMAP_USER environment variable is not set');
  process.exit(1);
}

async function runStep(workflowFn, ...args) {
  const start = Date.now();
  const imap = newClient();
  let result;
  let stepError;
  try {
    await imap.connect();
    result = await workflowFn(imap, ...args);
  } catch (err) {
    stepError = err;
    const duration = Date.now() - start;
    logger.error(
      { step: workflowFn.name, duration, error: err.message },
      'Step failed'
    );
  } finally {
    await safeLogout(imap);
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

logger.info(
  {
    enabled: config.AI_ENABLED,
    ...(config.AI_ENABLED && {
      model: config.AI_MODEL,
      baseUrl: config.AI_BASE_URL,
      timeoutMs: config.AI_TIMEOUT_MS,
      maxRetries: config.AI_MAX_RETRIES,
      concurrency: config.AI_CONCURRENCY,
      maxInputTokens: config.AI_MAX_INPUT_TOKENS,
      maxOutputTokens: config.AI_MAX_OUTPUT_TOKENS,
      escalateToLowThreshold: config.AI_ESCALATE_TO_LOW_THRESHOLD,
      escalateToHighThreshold: config.AI_ESCALATE_TO_HIGH_THRESHOLD,
      userProfileConfigured: !!config.AI_USER_PROFILE,
    }),
  },
  'AI classification configuration'
);

// Built once, before the very first step, and reused for every subsequent
// step - this is what gives ctx.aiFailureTracker its process-lifetime
// persistence. runIdle takes an `options` object before ctx, so its call is
// the one with three arguments.
const ctx = createDefaultContext();

await runStep(runInit, ctx);

let failures = 0;
let lastUid;
while (!stopping) {
  try {
    // Run training steps
    await runStep(runSpam, ctx);
    if (stopping) break;
    await runStep(runHam, ctx);
    if (stopping) break;
    await runStep(runWhitelist, ctx);
    if (stopping) break;
    await runStep(runBlacklist, ctx);
    if (stopping) break;

    // Scan drain loop: repeat until no new messages remain
    let scanResult;
    do {
      scanResult = await runStep(runScan, ctx);
      if (scanResult && typeof scanResult.last_uid === 'number') {
        lastUid = scanResult.last_uid;
      }
    } while (!stopping && scanResult && scanResult.processed > 0);
    if (stopping) break;

    // Wait condition depends on mode
    if (scanInterval < 0) {
      // Single-run: exit after one cycle
      logger.info('Cycle complete, single-run mode');
      break;
    } else if (scanInterval === 0) {
      // IDLE mode: wait for IMAP EXISTS notification
      logger.info('Waiting for new messages (IDLE)');
      await runStep(
        runIdle,
        { signal: shutdownController.signal, lastUid },
        ctx
      );
      if (stopping) break;
      logger.info('IDLE wakeup received, restarting scan cycle');
    } else {
      // Poll mode: wait for next interval
      logger.info(
        { intervalSeconds: scanInterval },
        'Cycle complete, waiting for next poll'
      );
      await interruptibleSleep(scanInterval * 1000);
      if (stopping) break;
    }

    failures = 0;
  } catch (err) {
    if (stopping) break;
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
    await interruptibleSleep(backoff);
  }
}

if (stopping) {
  logger.info('Shutdown complete');
}
