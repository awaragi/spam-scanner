import { rootLogger } from '../../core/logger.js';
import {
  readScannerState,
  writeScannerState,
} from '../../clients/state-manager.client.js';
import { open, search } from '../../clients/imap.client.js';
import {
  computeUidValidityReset,
  buildScanQuery,
} from '../../services/scan-progress.service.js';
import { createDefaultContext } from '../../core/context.js';

const logger = rootLogger.forComponent('pending-messages');

/**
 * Locates the batch of message UIDs the next scan should process: reads
 * scanner state, opens the inbox, resets to new-mail-only on a UIDVALIDITY
 * change (persisting that reset immediately even if nothing new turns up,
 * so the next cycle doesn't re-detect the same mismatch and re-warn
 * forever), searches, and filters/caps the result to `SCAN_BATCH_SIZE`.
 * @param {Object} imap - ImapFlow client
 * @param {Object} [ctx]
 * @returns {Promise<{state: Object, uids: Array<number>}>} - `uids` is empty when there's nothing new
 */
export async function locatePendingMessages(
  imap,
  ctx = createDefaultContext()
) {
  const { config: cfg } = ctx;
  const now = new Date().toISOString();
  const defaultState = {
    last_uid: 0,
    last_seen_date: now,
    last_checked: now,
  };
  const state = await readScannerState(imap, defaultState, cfg.FOLDER_INBOX);

  const mailbox = await open(imap, cfg.FOLDER_INBOX);

  // UIDVALIDITY identifies a specific numbering "epoch" for this mailbox's
  // UIDs; a mismatch is treated the same as "no state" - reset to
  // new-mail-only rather than either trusting the stale UID or rescanning
  // the whole inbox.
  const uidReset = computeUidValidityReset(state, mailbox);
  if (uidReset.changed) {
    logger.warn(
      {
        folder: cfg.FOLDER_INBOX,
        previousUidValidity: uidReset.previousUidValidity,
        currentUidValidity: uidReset.currentUidValidity,
        previousLastUid: state.last_uid,
        resetLastUid: uidReset.state.last_uid,
      },
      'UIDVALIDITY changed - resetting to new-mail-only instead of trusting stale UIDs'
    );
  }
  Object.assign(state, uidReset.state);

  const query = buildScanQuery(state, cfg.SCAN_READ);
  // Filter out UIDs <= last_uid: IMAP returns the max UID when the range start
  // exceeds the mailbox max (e.g. "7385:*" becomes "7384:7385"), causing the
  // last processed email to always be re-scanned.
  const newUIDs = (await search(imap, query)).filter(
    uid => uid > state.last_uid
  );

  if (newUIDs.length === 0) {
    if (uidReset.changed) {
      await writeScannerState(imap, {
        last_uid: state.last_uid,
        last_seen_date: state.last_seen_date,
        last_checked: new Date().toISOString(),
        uid_validity: state.uid_validity,
      });
    }
    return { state, uids: [] };
  }

  return { state, uids: newUIDs.slice(0, cfg.SCAN_BATCH_SIZE) };
}
