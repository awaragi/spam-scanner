/**
 * Utility functions for classifying spam messages
 */

/**
 * Categorizes messages based on spam score
 * @param {Array} messages - Array of messages with spam information
 * @param cleanThreshold
 * @param lowProbableThreshold
 * @param highProbableThreshold
 * @returns {Object} - Object with categorized messages
 */
export function categorizeMessages(
  messages,
  cleanThreshold = 30,
  lowProbableThreshold = 60,
  highProbableThreshold = 100
) {
  const whitelistedMessages = [];
  const lowSpamMessages = [];
  const highSpamMessages = [];
  const nonSpamMessages = [];
  const spamMessages = [];

  messages.forEach(message => {
    const { score, required, isSpam, isWhitelisted } = message.spamInfo;
    const scorePercentage =
      score !== null && required !== null && required !== 0
        ? (score / required) * 100
        : null;

    if (isSpam) {
      // rspamd's own "reject" verdict always wins, even for a whitelisted sender.
      spamMessages.push(message);
    } else if (isWhitelisted) {
      whitelistedMessages.push(message);
    } else {
      if (scorePercentage === null) {
        nonSpamMessages.push(message);
      } else if (scorePercentage <= cleanThreshold) {
        nonSpamMessages.push(message);
      } else if (scorePercentage < lowProbableThreshold) {
        lowSpamMessages.push(message);
      } else if (scorePercentage < highProbableThreshold) {
        highSpamMessages.push(message);
      } else {
        // default
        highSpamMessages.push(message);
      }
    }
  });

  return {
    whitelistedMessages,
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
