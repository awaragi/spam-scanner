import { rootLogger } from '../utils/logger.js';
import { extractSenders } from '../utils/email.js';
import { readMapState, writeMapState } from '../state-manager.js';
import {
  mergeAddresses,
  overrideAddresses,
  normalizeEmail,
} from '../utils/sender-lists.js';

const logger = rootLogger.forComponent('map-service');

/**
 * Extract sender addresses from messages
 * Pure function for extracting normalized email addresses
 * @param {Array} messages - Array of message objects with headers
 * @returns {Array<string>} - Array of unique sender email addresses
 */
export function extractSenderAddresses(messages) {
  const senders = [];

  for (const message of messages) {
    const { uid, headers } = message;
    const messageLogger = logger.forMessage(uid);
    const messageSenders = extractSenders(headers);

    if (messageSenders.length > 0) {
      senders.push(...messageSenders);
      messageLogger.debug({ senders: messageSenders }, 'Extracted senders');
    } else {
      messageLogger.debug('No extractable senders found');
    }
  }

  // Return unique senders
  return [...new Set(senders)];
}

/**
 * Update a mailbox's IMAP-backed whitelist/blacklist state with sender
 * addresses, in either `append` (merge with existing entries) or `override`
 * (replace existing entries entirely) mode.
 * @param {Object} imap - ImapFlow client
 * @param {string} mapStateKey - State key identifying the list (see config.js STATE_KEY_WHITELIST_MAP/STATE_KEY_BLACKLIST_MAP)
 * @param {Array<string>} senders - Array of sender email addresses
 * @param {'append'|'override'} [mode] - append merges with existing entries; override replaces them
 * @returns {Promise<Object>} - {added, skipped, removed, total}
 */
export async function updateListState(
  imap,
  mapStateKey,
  senders,
  mode = 'append'
) {
  logger.debug(
    { mapStateKey, mode, count: senders.length },
    'Updating list state'
  );

  const existing = await readMapState(imap, mapStateKey);

  const list =
    mode === 'override'
      ? overrideAddresses(senders)
      : mergeAddresses(existing, senders);

  const existingSet = new Set(existing.map(normalizeEmail).filter(Boolean));
  const listSet = new Set(list);
  const added = list.filter(address => !existingSet.has(address));
  const skipped = senders
    .map(normalizeEmail)
    .filter(address => address && existingSet.has(address));
  const removed = existing.filter(
    address => !listSet.has(normalizeEmail(address))
  );

  // Pretty-printed so the raw IMAP state message is human-readable without
  // a JSON formatter.
  await writeMapState(imap, mapStateKey, JSON.stringify(list, null, 2));

  const result = { added, skipped, removed, total: list.length };
  logger.debug({ mapStateKey, mode, ...result }, 'List state updated');
  return result;
}
