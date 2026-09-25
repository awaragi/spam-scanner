import { Injectable } from '@nestjs/common';
import { createAppFolders } from '../../infrastructure/imap/mailbox.gateway.js';
import type { MailboxSession } from '../mailbox-session.js';

/**
 * Ensures every IMAP folder a mailbox needs exists, ported from terminal's
 * `init.controller.ts`'s `runInit`. Unlike terminal, folder resolution
 * against the server's real hierarchy delimiter has already happened by the
 * time a `MailboxSession` exists (see `folder.resolver.ts` / design.md D6),
 * so this only reads the already-resolved folder names off
 * `session.folders` and `session.settings.processingMode` - it does not
 * resolve anything itself.
 */
@Injectable()
export class FolderInitService {
  /**
   * Creates (or confirms the existence of) every folder this mailbox needs:
   * the four training folders, the state folder and the spam folder, plus -
   * when `session.settings.processingMode` is `'folder'` - the spam
   * likelihood folders. Uses `session.imap` for the IMAP connection and
   * `session.logger` for logging, in place of terminal's ambient
   * `rootLogger`.
   * @param session - The mailbox session to initialize folders for.
   */
  async initFolders(session: MailboxSession): Promise<void> {
    const { imap, folders, settings, logger } = session;

    const foldersToEnsure = [
      folders.trainSpam,
      folders.trainHam,
      folders.trainWhitelist,
      folders.trainBlacklist,
      folders.state,
      folders.spam,
    ];

    if (settings.processingMode === 'folder') {
      logger.debug(
        'Processing mode is folder, including spam likelihood folders'
      );
      foldersToEnsure.push(folders.spamLow, folders.spamHigh);
    }

    await createAppFolders(imap, foldersToEnsure, logger);
    logger.debug('Folder initialization completed');
  }
}
