/**
 * Domain rules for classifying spam messages. Pure, never sees `ctx`.
 */
import { senderAddressOf, isSenderListed } from './sender-lists.service.ts';

interface ScoredMessage {
  spamInfo: { score: number | null; required: number | null };
}

interface CategorizedBuckets<M> {
  nonSpamMessages: M[];
  lowSpamMessages: M[];
  highSpamMessages: M[];
  spamMessages: M[];
}

interface AiScoredMessage {
  uid?: number;
  aiInfo?: { score?: number | null };
}

interface EnvelopeAddressed {
  envelope?: { from?: Array<{ address?: string }> };
}

interface WhitelistableMessage extends EnvelopeAddressed {
  spamInfo: {
    score: number;
    senderAuthenticated?: boolean;
    isWhitelisted?: boolean;
  };
}

interface WhitelistFlaggedMessage {
  uid?: number;
  spamInfo?: { isWhitelisted?: boolean; senderAuthenticated?: boolean };
}

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
export function categorizeMessages<M extends ScoredMessage>(
  messages: M[],
  cleanThreshold: number,
  lowThreshold: number,
  confirmedThreshold: number
): CategorizedBuckets<M> {
  const lowSpamMessages: M[] = [];
  const highSpamMessages: M[] = [];
  const nonSpamMessages: M[] = [];
  const spamMessages: M[] = [];

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
function aiTargetRank(
  score: number | null | undefined,
  escalateToLowThreshold: number,
  escalateToHighThreshold: number
): number | null {
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
export function applyAiEscalation<M extends AiScoredMessage>(
  categorized: CategorizedBuckets<M>,
  aiResults: { nonSpamMessages: M[]; lowSpamMessages: M[] },
  thresholds: {
    escalateToLowThreshold?: number;
    escalateToHighThreshold?: number;
  } = {}
): CategorizedBuckets<M> {
  const escalateToLowThreshold = thresholds.escalateToLowThreshold ?? 50;
  const escalateToHighThreshold = thresholds.escalateToHighThreshold ?? 80;

  const nonSpamMessages: M[] = [];
  const lowSpamMessages: M[] = [];
  const highSpamMessages: M[] = [...categorized.highSpamMessages];
  const spamMessages: M[] = [...categorized.spamMessages];

  function place(message: M, originRank: number): void {
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
 * Pure - the whitelist score adjustment rspamd's own multimap rule used to
 * apply, now computed here since rspamd is a stateless content scorer with
 * no list awareness (see `sender-lists` capability). The full -20 discount
 * only applies when rspamd also found a passing DKIM/DMARC symbol for the
 * message (`senderAuthenticated`); an unauthenticated whitelist match
 * (address matched, but nothing proves the message actually came from it -
 * the most common phishing pattern) gets a smaller -5 discount instead, so a
 * spoofed "trusted" sender's spammy content can still reach `confirmed`.
 * @param {number} rawScore
 * @param {boolean} isWhitelisted
 * @param {boolean} [senderAuthenticated]
 * @returns {number}
 */
export function applyWhitelistAdjustment(
  rawScore: number,
  isWhitelisted: boolean,
  senderAuthenticated = false
): number {
  if (!isWhitelisted) return rawScore;
  return senderAuthenticated ? rawScore - 20 : rawScore - 5;
}

/**
 * Batch counterpart to `applyWhitelistAdjustment`: stamps `isWhitelisted`
 * and the adjusted score onto each already-rspamd-checked message's
 * `spamInfo`, and counts how many were whitelisted. This is where
 * `rspamd-check.step.js` used to do per-message whitelist lookup/adjustment
 * before attaching `spamInfo` - now split out since rspamd itself has no
 * list awareness (see `sender-lists` capability). `senderAuthenticated` is
 * read from `spamInfo` (set by `rspamd-check.step.js` from rspamd's own
 * DKIM/DMARC symbols) and passed through unchanged - it's not computed here.
 * @param {Array} messages - already-checked messages (spamInfo.score/required/senderAuthenticated set)
 * @param {Set<string>} whitelistSet - normalized whitelist entries (addresses and/or "@domain" entries)
 * @returns {{messages: Array, whitelistedTotal: number}}
 */
export function applyWhitelistAdjustments<M extends WhitelistableMessage>(
  messages: M[],
  whitelistSet: Set<string>
): { messages: M[]; whitelistedTotal: number } {
  let whitelistedTotal = 0;
  const adjusted = messages.map(message => {
    const isWhitelisted = isSenderListed(
      senderAddressOf(message),
      whitelistSet
    );
    const senderAuthenticated = Boolean(message.spamInfo.senderAuthenticated);
    if (isWhitelisted) whitelistedTotal++;
    return {
      ...message,
      spamInfo: {
        ...message.spamInfo,
        isWhitelisted,
        score: applyWhitelistAdjustment(
          message.spamInfo.score,
          isWhitelisted,
          senderAuthenticated
        ),
      },
    };
  });
  return { messages: adjusted, whitelistedTotal };
}

/**
 * Splits a list of already-categorized messages by whether their sender was
 * both whitelisted AND authenticated (`spamInfo.isWhitelisted` and
 * `spamInfo.senderAuthenticated`, set by `applyWhitelistAdjustments`).
 * Used only to decide AI eligibility - it never changes which tier a
 * message is in. An unauthenticated whitelist match (address matched, but
 * rspamd found no passing DKIM/DMARC symbol) does NOT skip AI - it's
 * treated like a non-whitelisted message, since the match alone doesn't
 * establish the sender is who the whitelist entry names (see
 * `sender-lists` capability).
 * @param {Array} messages
 * @returns {{whitelisted: Array, rest: Array}}
 */
export function partitionByWhitelistFlag<M extends WhitelistFlaggedMessage>(
  messages: M[]
): { whitelisted: M[]; rest: M[] } {
  const whitelisted: M[] = [];
  const rest: M[] = [];
  for (const message of messages) {
    const isTrustedMatch =
      message.spamInfo?.isWhitelisted && message.spamInfo?.senderAuthenticated;
    (isTrustedMatch ? whitelisted : rest).push(message);
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
export function mergeWhitelistedBack<M>(
  categorized: CategorizedBuckets<M>,
  nonSpamWhitelisted: M[],
  lowSpamWhitelisted: M[]
): CategorizedBuckets<M> {
  return {
    ...categorized,
    nonSpamMessages: [...categorized.nonSpamMessages, ...nonSpamWhitelisted],
    lowSpamMessages: [...categorized.lowSpamMessages, ...lowSpamWhitelisted],
  };
}
