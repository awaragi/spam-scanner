/**
 * Utility functions for whitelist/blacklist sender-address normalization
 * and matching, keyed on the address rspamd's own multimap rules used to
 * match on (the message's From address) - see the `sender-lists` capability.
 */

/**
 * Normalize an email address: trim, lowercase. Returns null for anything
 * that isn't a plausible address (no `@`), so callers can filter it out.
 * @param {string} email
 * @returns {string|null}
 */
export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') {
    return null;
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) {
    return null;
  }
  return normalized;
}

/**
 * Extracts a message's sender address from its IMAP envelope.
 * @param {Object} message - Message object with an `envelope` property
 * @returns {string|null} - Normalized sender address, or null if absent
 */
export function senderAddressOf(message) {
  const address = message?.envelope?.from?.[0]?.address;
  return normalizeEmail(address);
}

/**
 * Merges normalized, deduplicated incoming addresses into an existing list.
 * @param {Array<string>} existing
 * @param {Array<string>} incoming
 * @returns {Array<string>} - Deduplicated union, existing entries first
 */
export function mergeAddresses(existing, incoming) {
  const normalizedExisting = existing.map(normalizeEmail).filter(Boolean);
  const normalizedIncoming = incoming.map(normalizeEmail).filter(Boolean);

  const seen = new Set(normalizedExisting);
  const merged = [...normalizedExisting];

  for (const address of normalizedIncoming) {
    if (!seen.has(address)) {
      seen.add(address);
      merged.push(address);
    }
  }

  return merged;
}

/**
 * Normalizes and deduplicates a list of addresses, ignoring any existing
 * list entirely - used for `override` mode.
 * @param {Array<string>} incoming
 * @returns {Array<string>}
 */
export function overrideAddresses(incoming) {
  const seen = new Set();
  const result = [];

  for (const raw of incoming) {
    const address = normalizeEmail(raw);
    if (address && !seen.has(address)) {
      seen.add(address);
      result.push(address);
    }
  }

  return result;
}

/**
 * Parses raw file content into normalized addresses, for the import script.
 * `txt` is the legacy newline-delimited map format; `json` is a JSON array
 * of address strings (the same shape list state is stored in, and what
 * the export script's `--format json` produces).
 * @param {string} raw
 * @param {'txt'|'json'} [format]
 * @returns {Array<string>}
 */
export function parseAddressList(raw, format = 'txt') {
  const rawAddresses = format === 'json' ? JSON.parse(raw) : raw.split('\n');
  return rawAddresses.map(normalizeEmail).filter(Boolean);
}

/**
 * Serializes a list of (already normalized) addresses for the export
 * script. `txt` is one address per line; `json` is the raw array,
 * pretty-printed.
 * @param {Array<string>} addresses
 * @param {'txt'|'json'} [format]
 * @returns {string}
 */
export function serializeAddressList(addresses, format = 'txt') {
  if (format === 'json') {
    return JSON.stringify(addresses, null, 2);
  }
  return addresses.length ? addresses.join('\n') + '\n' : '';
}
