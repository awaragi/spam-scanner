import { config } from '../core/config.ts';
import { splitFolderParts } from '../utils/mailboxes.util.ts';
import { getImapDelimiter } from './imap.client.ts';
import { rootLogger } from '../core/logger.ts';

const logger = rootLogger.forComponent('folder-resolver');

/**
 * Resolves every configured, delimiter-neutral FOLDER_* setting against the
 * IMAP server's actual hierarchy delimiter (discovered via LIST), mutating
 * `config` in place so the rest of the codebase keeps reading `config.FOLDER_*`
 * exactly as it does for every other setting - no separate accessor needed.
 * Must be called once, during startup init, before any workflow reads a
 * folder path. Naturally idempotent if called more than once: splitFolderParts
 * treats `.`, `/` and `\` as equivalent separators, so re-splitting an
 * already-resolved value and rejoining with the same delimiter is a no-op.
 * @param {Object} imap - Connected ImapFlow client
 * @returns {Promise<void>}
 */
export async function resolveFolders(imap) {
  const delimiter = await getImapDelimiter(imap);
  if (!delimiter) {
    throw new Error(
      'Failed to resolve folder paths: could not determine IMAP server delimiter'
    );
  }

  for (const key of Object.keys(config)) {
    if (!key.startsWith('FOLDER_')) {
      continue;
    }
    const value = config[key];
    if (typeof value !== 'string') {
      continue;
    }
    config[key] = splitFolderParts(value).join(delimiter);
  }

  logger.debug({ delimiter }, 'Resolved folder paths');
}
