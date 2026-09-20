import { rootLogger } from '../../utils/logger.js';
import {
  readMapState,
  writeMapState,
} from '../../clients/state-manager.client.js';
import { diffListUpdate } from '../../services/list-diff.service.js';
import { createDefaultContext } from '../../config/context.js';

const logger = rootLogger.forComponent('list-update');

/**
 * Update a mailbox's IMAP-backed whitelist/blacklist state with sender
 * addresses, in either `append` (merge with existing entries) or `override`
 * (replace existing entries entirely) mode.
 * @param {Object} imap - ImapFlow client
 * @param {string} mapStateKey - State key identifying the list (see config.js STATE_KEY_WHITELIST_MAP/STATE_KEY_BLACKLIST_MAP)
 * @param {Array<string>} senders - Array of sender email addresses
 * @param {'append'|'override'} [mode] - append merges with existing entries; override replaces them
 * @param {Object} [ctx] - unused today; present for interface consistency across steps
 * @returns {Promise<Object>} - {added, skipped, removed, total}
 */
export async function updateListState(
  imap,
  mapStateKey,
  senders,
  mode = 'append',
  ctx = createDefaultContext() // eslint-disable-line no-unused-vars
) {
  logger.debug(
    { mapStateKey, mode, count: senders.length },
    'Updating list state'
  );

  const existing = await readMapState(imap, mapStateKey);
  const { list, added, skipped, removed, total } = diffListUpdate(
    existing,
    senders,
    mode
  );

  // Pretty-printed so the raw IMAP state message is human-readable without
  // a JSON formatter.
  await writeMapState(imap, mapStateKey, JSON.stringify(list, null, 2));

  const result = { added, skipped, removed, total };
  logger.debug({ mapStateKey, mode, ...result }, 'List state updated');
  return result;
}
