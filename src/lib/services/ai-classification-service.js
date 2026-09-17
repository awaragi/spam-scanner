import { rootLogger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import { extractAiContent, formatAddressList } from '../utils/ai-content.js';
import { classifyEmail } from '../clients/ai-client.js';
import { recordFailure, recordSuccess } from './ai-failure-tracker.js';

const logger = rootLogger.forComponent('ai-classification');

/**
 * Identifying fields for log lines, sourced from the envelope directly (always
 * available, even if content extraction itself fails) rather than from the
 * AI-extracted content - so a UID alone is never the only way to find the email.
 * @param {Object} message
 * @returns {{subject: string, from: string}}
 */
function logIdentity(message) {
  return {
    subject: message.envelope?.subject || '',
    from: formatAddressList(message.envelope?.from),
  };
}

/**
 * Classifies a single message with the AI, never throwing - failures are logged
 * and reflected as aiInfo.error so the caller can fail open (no escalation).
 * Also feeds the outcome to the failure tracker; if this failure is the first
 * in the batch to cross the consecutive-same-reason alert threshold, records
 * it on `alertRef` (first crossing in the batch wins - later ones are still
 * fed to the tracker but don't overwrite `alertRef`).
 * @param {Object} message
 * @param {{value: Object|null}} alertRef
 * @returns {Promise<Object>} - message with `aiInfo: {score, reasoning, error}` attached
 */
async function classifyOne(message, alertRef) {
  const messageLogger = logger.forMessage(message.uid);
  const identity = logIdentity(message);
  try {
    const content = await extractAiContent(message);
    const { score, reasoning } = await classifyEmail(content);
    messageLogger.info(
      { ...identity, score, reasoning },
      'AI classification completed'
    );
    recordSuccess();
    return { ...message, aiInfo: { score, reasoning, error: null } };
  } catch (err) {
    messageLogger.error(
      { ...identity, error: err.message },
      'AI classification failed - message stays in original bucket (fail-open)'
    );
    const { shouldAlert, reason, count, lastError, lastAt } = recordFailure(err);
    if (shouldAlert && !alertRef.value) {
      alertRef.value = { reason, count, lastError, lastAt };
    }
    return {
      ...message,
      aiInfo: { score: null, reasoning: null, error: err.message },
    };
  }
}

/**
 * Runs an async function over items with a bounded number of concurrent workers.
 * @param {Array} items
 * @param {number} limit
 * @param {(item: any) => Promise<any>} fn
 * @returns {Promise<Array>} - results in the same order as items
 */
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, worker));

  return results;
}

/**
 * Runs AI classification on rspamd's nonSpam/lowSpam candidate buckets only.
 * Never throws - per-message failures are caught and fail open (no escalation).
 * @param {{nonSpamMessages: Array, lowSpamMessages: Array}} candidates
 * @returns {Promise<{nonSpamMessages: Array, lowSpamMessages: Array, aiFailureAlert: Object|null}>} - same
 *   messages, each with `aiInfo` attached, plus `aiFailureAlert` (`{reason, count, lastError, lastAt}`)
 *   when this batch's failures newly crossed the consecutive-same-reason alert threshold
 */
export async function classifyWithAi({ nonSpamMessages, lowSpamMessages }) {
  const all = [...nonSpamMessages, ...lowSpamMessages];
  if (all.length === 0) {
    return { nonSpamMessages: [], lowSpamMessages: [], aiFailureAlert: null };
  }

  const alertRef = { value: null };
  const results = await mapWithConcurrency(all, config.AI_CONCURRENCY, item =>
    classifyOne(item, alertRef)
  );

  logger.info(
    {
      total: results.length,
      failed: results.filter(m => m.aiInfo.error).length,
    },
    'AI classification batch completed'
  );

  return {
    nonSpamMessages: results.slice(0, nonSpamMessages.length),
    lowSpamMessages: results.slice(nonSpamMessages.length),
    aiFailureAlert: alertRef.value,
  };
}
