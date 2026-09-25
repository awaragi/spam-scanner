import type { ImapFlow } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';
import {
  readMapState,
  writeMapState,
} from '../../infrastructure/state/sender-list.repository.js';
import { diffListUpdate } from '../../domain/sender-lists/list-diff.js';

/**
 * Update a mailbox's IMAP-backed whitelist/blacklist state with sender
 * addresses, in either `append` (merge with existing entries) or `override`
 * (replace existing entries entirely) mode. Ported from terminal's
 * `list-update.step.ts`, kept as a co-located step alongside
 * `sender-list-training.service.ts`.
 * @param imap - Connected ImapFlow client
 * @param stateFolder - Path to the mailbox's state folder
 * @param mapStateKey - State key identifying the list (see
 *   `STATE_KEY_WHITELIST_MAP`/`STATE_KEY_BLACKLIST_MAP`)
 * @param senders - Array of sender email addresses
 * @param [mode] - append merges with existing entries; override replaces them
 * @param logger - Session-scoped logger
 * @returns - {added, skipped, removed, total}
 */
export async function updateListState(
  imap: ImapFlow,
  stateFolder: string,
  mapStateKey: string,
  senders: string[],
  mode: 'append' | 'override' = 'append',
  logger?: PinoLogger
): Promise<{
  added: string[];
  skipped: string[];
  removed: string[];
  total: number;
}> {
  logger?.debug(
    { mapStateKey, mode, count: senders.length },
    'Updating list state'
  );

  const existing = await readMapState(imap, stateFolder, mapStateKey, logger);
  const { list, added, skipped, removed, total } = diffListUpdate(
    existing,
    senders,
    mode
  );

  // Pretty-printed so the raw IMAP state message is human-readable without
  // a JSON formatter.
  await writeMapState(
    imap,
    stateFolder,
    mapStateKey,
    JSON.stringify(list, null, 2),
    logger
  );

  const result = { added, skipped, removed, total };
  logger?.debug({ mapStateKey, mode, ...result }, 'List state updated');
  return result;
}
