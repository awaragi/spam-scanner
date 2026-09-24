import { waitForNewMail } from '../../clients/imap.client.ts';
import { createDefaultContext } from '../../core/context.ts';

/**
 * Waits for new mail to arrive in FOLDER_INBOX. Thin pass-through to
 * imap.client.ts's waitForNewMail() - see there for the IMAP IDLE mechanics
 * (pre-IDLE catch-up, watchdog, abort handling).
 * @param {Object} imap - ImapFlow client
 * @param {{signal?: AbortSignal, lastUid?: number, watchdogMs?: number}} [options]
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
export async function runIdle(
  imap,
  options = {},
  ctx = createDefaultContext()
) {
  await waitForNewMail(imap, ctx.config.FOLDER_INBOX, options);
}
