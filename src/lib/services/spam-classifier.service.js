/**
 * Domain rules for classifying spam messages. Pure, never sees `ctx`.
 */
import { senderAddressOf } from './sender-lists.service.js';

/**
 * Categorizes messages into four score-percentage-driven tiers - clean, low,
 * high, confirmed - per the `scan-inbox` capability. `scorePercentage` is
 * `(spamInfo.score / spamInfo.required) * 100`, where `spamInfo.score` is
 * already whitelist-adjusted (see `message-service.js`) before this runs.
 * Tier assignment is purely a function of that score - `isWhitelisted` is
 * NOT read here at all. Whitelist only ever influences the score itself
 * (the `-20` already applied upstream); it never overrides which tier a
 * message lands in, so a whitelisted sender whose content is bad enough
 * still gets classified `high` (or `confirmed`) like anyone else - it does
 * not get silently treated as `clean`. Whitelist's other effect (skipping
 * AI for `clean`/`low` messages) is applied by the caller, after this
 * function has already decided the tier - see `scan-workflow.js`.
 * Blacklist is not read here at all either - it's resolved upstream,
 * before rspamd is even called, and its results are merged into
 * `spamMessages` by the caller.
 * No defaults here - this stays config-agnostic pure logic, so the caller
 * (scan-workflow.js, reading config.SPAM_*_THRESHOLD) is the single source
 * of truth for what these thresholds actually are; a local default would
 * just be a second copy of the same numbers with nothing keeping them in
 * sync.
 * @param {Array} messages - Array of messages with spam information
 * @param {number} cleanThreshold - clean/low boundary
 * @param {number} lowThreshold - low/high boundary
 * @param {number} confirmedThreshold - high/confirmed boundary
 * @returns {Object} - Object with categorized messages
 */
export function categorizeMessages(
  messages,
  cleanThreshold,
  lowThreshold,
  confirmedThreshold
) {
  const lowSpamMessages = [];
  const highSpamMessages = [];
  const nonSpamMessages = [];
  const spamMessages = [];

  messages.forEach(message => {
    const { score, required } = message.spamInfo;
    const scorePercentage =
      score !== null && score !== undefined && required
        ? (score / required) * 100
        : null;

    if (scorePercentage === null || scorePercentage <= cleanThreshold) {
      nonSpamMessages.push(message);
    } else if (scorePercentage <= lowThreshold) {
      lowSpamMessages.push(message);
    } else if (scorePercentage < confirmedThreshold) {
      highSpamMessages.push(message);
    } else {
      spamMessages.push(message);
    }
  });

  return {
    lowSpamMessages,
    highSpamMessages,
    nonSpamMessages,
    spamMessages,
  };
}

const BUCKET_RANK = { nonSpam: 0, lowSpam: 1, highSpam: 2, spam: 3 };

/**
 * Maps an AI score to the bucket rank it would escalate a message to.
 * Deliberately cannot return BUCKET_RANK.spam - AI can never push a message
 * all the way to spam, only rspamd's own verdict can.
 * @param {number|null|undefined} score
 * @param {number} escalateToLowThreshold
 * @param {number} escalateToHighThreshold
 * @returns {number|null} - null means "no opinion" (score missing, or too low to escalate)
 */
function aiTargetRank(score, escalateToLowThreshold, escalateToHighThreshold) {
  if (score === null || score === undefined) return null;
  if (score >= escalateToHighThreshold) return BUCKET_RANK.highSpam;
  if (score >= escalateToLowThreshold) return BUCKET_RANK.lowSpam;
  return null;
}

/**
 * Re-buckets rspamd's nonSpam/lowSpam messages using AI scores, enforcing an
 * escalate-only policy: a message's final bucket can never be less severe than
 * the one rspamd originally assigned it, and AI can never escalate a message
 * as far as `spamMessages` (only rspamd's own verdict can do that).
 * @param {Object} categorized - original 4-bucket output of categorizeMessages
 * @param {{nonSpamMessages: Array, lowSpamMessages: Array}} aiResults - same messages, each with `aiInfo: {score}` attached
 * @param {{escalateToLowThreshold?: number, escalateToHighThreshold?: number}} [thresholds]
 * @returns {Object} - new 4-bucket object, same shape as categorizeMessages' return value
 */
export function applyAiEscalation(categorized, aiResults, thresholds = {}) {
  const escalateToLowThreshold = thresholds.escalateToLowThreshold ?? 50;
  const escalateToHighThreshold = thresholds.escalateToHighThreshold ?? 80;

  const nonSpamMessages = [];
  const lowSpamMessages = [];
  const highSpamMessages = [...categorized.highSpamMessages];
  const spamMessages = [...categorized.spamMessages];

  function place(message, originRank) {
    const targetRank = aiTargetRank(
      message.aiInfo?.score,
      escalateToLowThreshold,
      escalateToHighThreshold
    );
    const finalRank = Math.max(originRank, targetRank ?? originRank);

    switch (finalRank) {
      case BUCKET_RANK.highSpam:
        highSpamMessages.push(message);
        break;
      case BUCKET_RANK.lowSpam:
        lowSpamMessages.push(message);
        break;
      default:
        nonSpamMessages.push(message);
        break;
    }
  }

  aiResults.nonSpamMessages.forEach(message =>
    place(message, BUCKET_RANK.nonSpam)
  );
  aiResults.lowSpamMessages.forEach(message =>
    place(message, BUCKET_RANK.lowSpam)
  );

  return { nonSpamMessages, lowSpamMessages, highSpamMessages, spamMessages };
}

/**
 * Pure - the -20 whitelist adjustment rspamd's own multimap rule used to
 * apply, now computed here since rspamd is a stateless content scorer with
 * no list awareness (see `sender-lists` capability).
 * @param {number} rawScore
 * @param {boolean} isWhitelisted
 * @returns {number}
 */
export function applyWhitelistAdjustment(rawScore, isWhitelisted) {
  return isWhitelisted ? rawScore - 20 : rawScore;
}

/**
 * Batch counterpart to `applyWhitelistAdjustment`: stamps `isWhitelisted`
 * and the adjusted score onto each already-rspamd-checked message's
 * `spamInfo`, and counts how many were whitelisted. This is where
 * `rspamd-check.step.js` used to do per-message whitelist lookup/adjustment
 * before attaching `spamInfo` - now split out since rspamd itself has no
 * list awareness (see `sender-lists` capability).
 * @param {Array} messages - already-checked messages (spamInfo.score/required set)
 * @param {Set<string>} whitelistSet - normalized whitelist addresses
 * @returns {{messages: Array, whitelistedTotal: number}}
 */
export function applyWhitelistAdjustments(messages, whitelistSet) {
  let whitelistedTotal = 0;
  const adjusted = messages.map(message => {
    const isWhitelisted = whitelistSet.has(senderAddressOf(message));
    if (isWhitelisted) whitelistedTotal++;
    return {
      ...message,
      spamInfo: {
        ...message.spamInfo,
        isWhitelisted,
        score: applyWhitelistAdjustment(message.spamInfo.score, isWhitelisted),
      },
    };
  });
  return { messages: adjusted, whitelistedTotal };
}

/**
 * Splits a list of already-categorized messages by whether their sender was
 * whitelisted (`spamInfo.isWhitelisted`, set by `applyWhitelistAdjustment`'s
 * caller). Used only to decide AI eligibility - it never changes which tier
 * a message is in.
 * @param {Array} messages
 * @returns {{whitelisted: Array, rest: Array}}
 */
export function partitionByWhitelistFlag(messages) {
  const whitelisted = [];
  const rest = [];
  for (const message of messages) {
    (message.spamInfo?.isWhitelisted ? whitelisted : rest).push(message);
  }
  return { whitelisted, rest };
}

/**
 * Merges whitelisted messages (held back from AI classification/escalation)
 * back into an AI-escalated categorization's nonSpam/lowSpam tiers - the
 * tiers they were partitioned out of, so they land back where their own
 * (whitelist-adjusted) rspamd score already placed them.
 * @param {Object} categorized - output of applyAiEscalation
 * @param {Array} nonSpamWhitelisted - held-back whitelisted nonSpam messages
 * @param {Array} lowSpamWhitelisted - held-back whitelisted lowSpam messages
 * @returns {Object} - new object, same shape as categorized
 */
export function mergeWhitelistedBack(
  categorized,
  nonSpamWhitelisted,
  lowSpamWhitelisted
) {
  return {
    ...categorized,
    nonSpamMessages: [...categorized.nonSpamMessages, ...nonSpamWhitelisted],
    lowSpamMessages: [...categorized.lowSpamMessages, ...lowSpamWhitelisted],
  };
}
