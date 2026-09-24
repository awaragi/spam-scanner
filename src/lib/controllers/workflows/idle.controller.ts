import type { ImapFlow } from 'imapflow';
import { waitForNewMail } from '../../clients/imap.client.ts';
import { createDefaultContext, type Context } from '../../core/context.ts';

/**
 * Waits for new mail to arrive in FOLDER_INBOX. Thin pass-through to
 * imap.client.ts's waitForNewMail() - see there for the IMAP IDLE mechanics
 * (pre-IDLE catch-up, watchdog, abort handling).
 * @param imap - ImapFlow client
 * @param [options]
 * @param [ctx]
 */
export async function runIdle(
  imap: ImapFlow,
  options: { signal?: AbortSignal; lastUid?: number; watchdogMs?: number } = {},
  ctx: Context = createDefaultContext()
): Promise<void> {
  await waitForNewMail(imap, ctx.config.FOLDER_INBOX, options);
}
