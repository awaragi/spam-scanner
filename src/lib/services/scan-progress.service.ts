import { dateToString } from '../utils/email.util.ts';

/**
 * Domain rules for tracking scan progress through the inbox: how far the
 * scanner has advanced (`computeScanProgress`), what to do when the
 * mailbox's UIDVALIDITY epoch changes (`computeUidValidityReset`), and how
 * to build the next scan's search query (`buildScanQuery`). Pure, never
 * sees `ctx`.
 */

/**
 * Computes the scanner state fields after processing a batch of messages.
 * @param {{last_uid: number}} state - current scanner state
 * @param {Array<{uid: number, envelope: {date: any}}>} messages - the batch just processed
 * @param {() => string} [now]
 * @returns {{last_uid: number, last_seen_date: string, last_checked: string}}
 */
export function computeScanProgress(
  state,
  messages,
  now = () => new Date().toISOString()
) {
  const last_uid = Math.max(state.last_uid, ...messages.map(msg => msg.uid));

  const last_seen_date = messages.reduce((maxDate, message) => {
    const date = dateToString(message.envelope.date);
    if (!date) return maxDate;
    return date.localeCompare(maxDate) > 0 ? date : maxDate;
  }, new Date(0).toISOString());

  return { last_uid, last_seen_date, last_checked: now() };
}

/**
 * UIDVALIDITY identifies a specific numbering "epoch" for a mailbox's UIDs;
 * it changes if the server ever rebuilds its index or the account is
 * migrated. A last_uid stored under a stale UIDVALIDITY is meaningless under
 * the new one (it could even skip all new mail), so a mismatch is treated
 * the same as "no state" - reset to new-mail-only rather than either
 * trusting the stale UID or rescanning the whole inbox.
 * @param {{last_uid: number, uid_validity?: string}} state
 * @param {{uidValidity: bigint, uidNext: number}} mailbox
 * @returns {{state: Object, changed: boolean, previousUidValidity: string|undefined, currentUidValidity: string|undefined}}
 */
export function computeUidValidityReset(state, mailbox) {
  const currentUidValidity = mailbox.uidValidity?.toString();
  const changed =
    state.uid_validity !== undefined &&
    currentUidValidity !== undefined &&
    state.uid_validity !== currentUidValidity;

  const last_uid = changed
    ? mailbox.uidNext > 1
      ? mailbox.uidNext - 1
      : 0
    : state.last_uid;

  return {
    state: {
      ...state,
      last_uid,
      ...(currentUidValidity !== undefined && {
        uid_validity: currentUidValidity,
      }),
    },
    changed,
    previousUidValidity: state.uid_validity,
    currentUidValidity,
  };
}

/**
 * Builds the IMAP search query for the next batch of new messages.
 * @param {{last_uid: number}} state
 * @param {boolean} scanRead - SCAN_READ: when false, restricts to unseen messages
 * @returns {Object} - ImapFlow search query
 */
export function buildScanQuery(state, scanRead) {
  const query = { uid: `${state.last_uid + 1}:*` };
  if (!scanRead) {
    query.seen = false;
  }
  return query;
}

/**
 * Reduces one batch's counts into `runScan`'s running totals.
 * @param {{lowSpamTotal: number, highSpamTotal: number, nonSpamTotal: number, spamTotal: number, whitelistedTotal: number}} totals
 * @param {{lowSpamTotal: number, highSpamTotal: number, nonSpamTotal: number, spamTotal: number, whitelistedTotal: number}} counts
 * @returns {Object} - new totals object
 */
export function sumBatchTotals(totals, counts) {
  return {
    lowSpamTotal: totals.lowSpamTotal + counts.lowSpamTotal,
    highSpamTotal: totals.highSpamTotal + counts.highSpamTotal,
    nonSpamTotal: totals.nonSpamTotal + counts.nonSpamTotal,
    spamTotal: totals.spamTotal + counts.spamTotal,
    whitelistedTotal: totals.whitelistedTotal + counts.whitelistedTotal,
  };
}
