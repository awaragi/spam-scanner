import type { ImapFlow } from 'imapflow';

/**
 * Casts a partial IMAP test double (a plain object with just the methods a
 * given test exercises) to `ImapFlow`, for passing it to the strictly-typed
 * client/controller functions under test. The test double, not a real
 * `ImapFlow` instance, is the source of truth for behavior in these tests.
 */
export function asImapFlow<T extends object>(fake: T): ImapFlow {
  return fake as unknown as ImapFlow;
}
