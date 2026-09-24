import {
  mergeAddresses,
  overrideAddresses,
  normalizeEmail,
} from './sender-lists.service.ts';

/**
 * Computes the new list content and a diff summary for a whitelist/blacklist
 * update, in either `append` (merge with existing entries) or `override`
 * (replace existing entries entirely) mode. Pure - the caller is responsible
 * for reading the existing list and persisting `list`.
 * @param {Array<string>} existing - current list entries
 * @param {Array<string>} incoming - addresses being added
 * @param {'append'|'override'} [mode]
 * @returns {{list: Array<string>, added: Array<string>, skipped: Array<string>, removed: Array<string>, total: number}}
 */
export function diffListUpdate(existing, incoming, mode = 'append') {
  const list =
    mode === 'override'
      ? overrideAddresses(incoming)
      : mergeAddresses(existing, incoming);

  const existingSet = new Set(existing.map(normalizeEmail).filter(Boolean));
  const listSet = new Set(list);
  const added = list.filter(address => !existingSet.has(address));
  const skipped = incoming
    .map(normalizeEmail)
    .filter(address => address && existingSet.has(address));
  const removed = existing.filter(
    address => !listSet.has(normalizeEmail(address))
  );

  return { list, added, skipped, removed, total: list.length };
}
