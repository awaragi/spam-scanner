import type { ImapFlow } from 'imapflow';
import { readMapState } from '../../clients/state-manager.client.ts';
import { createDefaultContext, type Context } from '../../core/context.ts';

/**
 * Loads the whitelist/blacklist sender sets once per `runScan` call, not
 * once per batch - the underlying IMAP-backed state doesn't change mid-scan
 * (see the `sender-lists` capability). Sequential, not Promise.all: each
 * read switches the connection's selected mailbox and restores it
 * afterward, which isn't safe to run concurrently on a single IMAP
 * connection.
 * @param {Object} imap - ImapFlow client
 * @param {Object} [ctx]
 * @returns {Promise<{whitelistSet: Set<string>, blacklistSet: Set<string>}>}
 */
export async function loadSenderLists(
  imap: ImapFlow,
  ctx: Context = createDefaultContext()
): Promise<{ whitelistSet: Set<string>; blacklistSet: Set<string> }> {
  const { config: cfg } = ctx;
  const whitelistEntries = await readMapState(
    imap,
    cfg.STATE_KEY_WHITELIST_MAP
  );
  const blacklistEntries = await readMapState(
    imap,
    cfg.STATE_KEY_BLACKLIST_MAP
  );
  return {
    whitelistSet: new Set(whitelistEntries),
    blacklistSet: new Set(blacklistEntries),
  };
}
