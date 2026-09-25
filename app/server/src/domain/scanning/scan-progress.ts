/**
 * Domain rules for tracking scan progress through the inbox: how far the
 * scanner has advanced (`computeScanProgress`), what to do when the
 * mailbox's UIDVALIDITY epoch changes (`computeUidValidityReset`), and how
 * to build the next scan's search query (`buildScanQuery`). Pure, never
 * sees `ctx`.
 */

import { dateToString } from '../utils/email.js';

/**
 * Computes the scanner state fields after processing a batch of messages.
 * @param state - current scanner state
 * @param messages - the batch just processed
 * @param [now]
 */
interface UidState {
  last_uid: number;
}

interface DatedMessage {
  uid: number;
  envelope: { date: unknown };
}

export function computeScanProgress(
  state: UidState,
  messages: DatedMessage[],
  now: () => string = () => new Date().toISOString()
): { last_uid: number; last_seen_date: string; last_checked: string } {
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
 * @param state
 * @param mailbox
 */
interface ValidityState {
  last_uid: number;
  uid_validity?: string;
}

interface MailboxValidity {
  uidValidity: bigint;
  uidNext: number;
}

export function computeUidValidityReset(
  state: ValidityState,
  mailbox: MailboxValidity
): {
  state: ValidityState;
  changed: boolean;
  previousUidValidity: string | undefined;
  currentUidValidity: string | undefined;
} {
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
 * @param state
 * @param scanRead - SCAN_READ: when false, restricts to unseen messages
 * @returns - ImapFlow search query
 */
export function buildScanQuery(
  state: UidState,
  scanRead: boolean
): { uid: string; seen?: false } {
  const query: { uid: string; seen?: false } = {
    uid: `${state.last_uid + 1}:*`,
  };
  if (!scanRead) {
    query.seen = false;
  }
  return query;
}

/**
 * Reduces one batch's counts into `runScan`'s running totals.
 * @param totals
 * @param counts
 * @returns - new totals object
 */
interface BatchTotals {
  lowSpamTotal: number;
  highSpamTotal: number;
  nonSpamTotal: number;
  spamTotal: number;
  whitelistedTotal: number;
}

export function sumBatchTotals(
  totals: BatchTotals,
  counts: BatchTotals
): BatchTotals {
  return {
    lowSpamTotal: totals.lowSpamTotal + counts.lowSpamTotal,
    highSpamTotal: totals.highSpamTotal + counts.highSpamTotal,
    nonSpamTotal: totals.nonSpamTotal + counts.nonSpamTotal,
    spamTotal: totals.spamTotal + counts.spamTotal,
    whitelistedTotal: totals.whitelistedTotal + counts.whitelistedTotal,
  };
}
