import type { ImapFlow } from 'imapflow';
import type { MailboxFolderSettings } from '../../config/mailbox-settings.defaults.js';
import { splitFolderParts } from '../../domain/utils/mailboxes.js';
import { getImapDelimiter } from './mailbox.gateway.js';

/**
 * A mailbox's folders: the folder-name fields from `MailboxFolderSettings`
 * plus the state folder (which lives on `MailboxConnectionConfig`, not
 * `MailboxSettings`, since it is connection info rather than a behavioral
 * setting). Used both as the delimiter-neutral input to
 * `resolveMailboxFolders` and as its resolved output - the shape is
 * identical either way, only whether each path has been joined with the
 * server's actual hierarchy delimiter differs.
 */
export interface MailboxFolders extends MailboxFolderSettings {
  state: string;
}

/**
 * Resolves a mailbox's delimiter-neutral folders against the IMAP server's
 * actual hierarchy delimiter (discovered via LIST), returning a new
 * `MailboxFolders` object rather than mutating anything.
 *
 * Unlike terminal's `resolveFolders`, which rewrote the single shared global
 * `config` object in place, this takes the mailbox's own folders as an
 * explicit argument and returns a fresh result every call - safe to call
 * concurrently for different mailboxes with different delimiters and
 * different folder settings, since no shared state is ever touched (see
 * design.md D6).
 *
 * Naturally idempotent if called more than once on an already-resolved
 * value: `splitFolderParts` treats `.`, `/` and `\` as equivalent
 * separators, so re-splitting an already-resolved value and rejoining with
 * the same delimiter is a no-op.
 *
 * @param imap - Connected ImapFlow client.
 * @param folders - The mailbox's delimiter-neutral folders (its folder
 *   settings plus its state folder).
 * @returns A new `MailboxFolders` object, each path resolved against the
 *   server's delimiter.
 * @throws If the IMAP server's hierarchy delimiter cannot be determined.
 */
export async function resolveMailboxFolders(
  imap: ImapFlow,
  folders: MailboxFolders
): Promise<MailboxFolders> {
  const delimiter = await getImapDelimiter(imap);
  if (!delimiter) {
    throw new Error(
      'Failed to resolve folder paths: could not determine IMAP server delimiter'
    );
  }

  const resolve = (folder: string): string =>
    splitFolderParts(folder).join(delimiter);

  return {
    inbox: resolve(folders.inbox),
    spam: resolve(folders.spam),
    spamLow: resolve(folders.spamLow),
    spamHigh: resolve(folders.spamHigh),
    trainSpam: resolve(folders.trainSpam),
    trainHam: resolve(folders.trainHam),
    trainWhitelist: resolve(folders.trainWhitelist),
    trainBlacklist: resolve(folders.trainBlacklist),
    state: resolve(folders.state),
  };
}
