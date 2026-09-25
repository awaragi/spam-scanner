import { Injectable } from '@nestjs/common';
import { ScanConfig } from '../../config/app-config.js';
import { open, search } from '../../infrastructure/imap/mailbox.gateway.js';
import {
  readScannerState,
  writeScannerState,
} from '../../infrastructure/state/scanner-state.repository.js';
import {
  computeUidValidityReset,
  buildScanQuery,
} from '../../domain/scanning/scan-progress.js';
import type { ScannerState } from '../../domain/state/state-format.js';
import type { MailboxSession } from '../mailbox-session.js';

/**
 * Locates the batch of message UIDs the next scan should process: reads
 * scanner state, opens the inbox, resets to new-mail-only on a UIDVALIDITY
 * change (persisting that reset immediately even if nothing new turns up,
 * so the next cycle doesn't re-detect the same mismatch and re-warn
 * forever), searches, and filters/caps the result to `BATCH_SCAN_SIZE`.
 *
 * Ported from terminal's `pending-messages.step.ts` (`locatePendingMessages`):
 * `BATCH_SCAN_SIZE` comes from the injected global `ScanConfig` (it's a
 * global batching knob, not per-mailbox behavior); the inbox/state folders
 * and the `scanRead`/`scanInitialState` settings come from the session (see
 * design.md D5's config-injection-vs-session-settings split).
 */
@Injectable()
export class PendingMessagesStep {
  constructor(private readonly scanConfig: ScanConfig) {}

  /**
   * @returns `uids` is empty when there's nothing new.
   */
  async locate(
    session: MailboxSession
  ): Promise<{ state: ScannerState; uids: number[] }> {
    const { imap, folders, settings, logger } = session;
    const now = new Date().toISOString();
    const defaultState = {
      last_uid: 0,
      last_seen_date: now,
      last_checked: now,
    };
    const state = await readScannerState(
      imap,
      folders.state,
      defaultState,
      folders.inbox,
      settings.scanInitialState,
      logger
    );

    const mailbox = await open(imap, folders.inbox, false, logger);

    // UIDVALIDITY identifies a specific numbering "epoch" for this mailbox's
    // UIDs; a mismatch is treated the same as "no state" - reset to
    // new-mail-only rather than either trusting the stale UID or rescanning
    // the whole inbox.
    const uidReset = computeUidValidityReset(state, mailbox);
    if (uidReset.changed) {
      logger.warn(
        {
          folder: folders.inbox,
          previousUidValidity: uidReset.previousUidValidity,
          currentUidValidity: uidReset.currentUidValidity,
          previousLastUid: state.last_uid,
          resetLastUid: uidReset.state.last_uid,
        },
        'UIDVALIDITY changed - resetting to new-mail-only instead of trusting stale UIDs'
      );
    }
    Object.assign(state, uidReset.state);

    const query = buildScanQuery(state, settings.scanRead);
    // Filter out UIDs <= last_uid: IMAP returns the max UID when the range
    // start exceeds the mailbox max (e.g. "7385:*" becomes "7384:7385"),
    // causing the last processed email to always be re-scanned.
    const newUIDs = (await search(imap, query, logger)).filter(
      uid => uid > state.last_uid
    );

    if (newUIDs.length === 0) {
      if (uidReset.changed) {
        await writeScannerState(
          imap,
          folders.state,
          {
            last_uid: state.last_uid,
            last_seen_date: state.last_seen_date,
            last_checked: new Date().toISOString(),
            uid_validity: state.uid_validity,
          },
          logger
        );
      }
      return { state, uids: [] };
    }

    return { state, uids: newUIDs.slice(0, this.scanConfig.batchScanSize) };
  }
}
