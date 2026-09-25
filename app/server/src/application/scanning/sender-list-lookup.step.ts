import { Injectable } from '@nestjs/common';
import { readMapState } from '../../infrastructure/state/sender-list.repository.js';
import {
  STATE_KEY_WHITELIST_MAP,
  STATE_KEY_BLACKLIST_MAP,
} from '../../domain/state/state-format.js';
import type { MailboxSession } from '../mailbox-session.js';

/**
 * Loads the whitelist/blacklist sender sets once per `runScan` call, not
 * once per batch - the underlying IMAP-backed state doesn't change mid-scan
 * (see the `sender-lists` capability). Sequential, not `Promise.all`: each
 * read switches the connection's selected mailbox and restores it
 * afterward, which isn't safe to run concurrently on a single IMAP
 * connection. Ported from terminal's `sender-list-lookup.step.ts`
 * (`loadSenderLists`), reading the state folder from `session.folders.state`
 * instead of `ctx.config.FOLDER_STATE`.
 */
@Injectable()
export class SenderListLookupStep {
  async load(
    session: MailboxSession
  ): Promise<{ whitelistSet: Set<string>; blacklistSet: Set<string> }> {
    const { imap, folders, logger } = session;
    const whitelistEntries = await readMapState(
      imap,
      folders.state,
      STATE_KEY_WHITELIST_MAP,
      logger
    );
    const blacklistEntries = await readMapState(
      imap,
      folders.state,
      STATE_KEY_BLACKLIST_MAP,
      logger
    );
    return {
      whitelistSet: new Set(whitelistEntries),
      blacklistSet: new Set(blacklistEntries),
    };
  }
}
