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
 * @param existing - current list entries
 * @param incoming - addresses being added
 * @param [mode]
 */
const isString = (value: string | null): value is string => value !== null;

export function diffListUpdate(
  existing: string[],
  incoming: string[],
  mode: 'append' | 'override' = 'append'
): {
  list: string[];
  added: string[];
  skipped: string[];
  removed: string[];
  total: number;
} {
  const list =
    mode === 'override'
      ? overrideAddresses(incoming)
      : mergeAddresses(existing, incoming);

  const existingSet = new Set(existing.map(normalizeEmail).filter(isString));
  const listSet = new Set(list);
  const added = list.filter(address => !existingSet.has(address));
  const skipped = incoming
    .map(normalizeEmail)
    .filter(
      (address): address is string =>
        address !== null && existingSet.has(address)
    );
  const removed = existing.filter(
    address => !listSet.has(normalizeEmail(address) ?? '')
  );

  return { list, added, skipped, removed, total: list.length };
}
