/**
 * Domain rules for whitelist/blacklist sender-address normalization,
 * matching, and extraction, keyed on the address rspamd's own multimap
 * rules used to match on (the message's From address) - see the
 * `sender-lists` capability. Pure, never sees `ctx`.
 */
import emailAddresses from 'email-addresses';
import { rootLogger } from '../core/logger.js';

const { parseOneAddress } = emailAddresses;
const logger = rootLogger.forComponent('sender-lists');

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

/**
 * Checks if an email address appears to be human-generated.
 * Filters out per-message tokens and generic bounce/relay subdomains while
 * keeping legitimate corporate senders (even if automated). Deliberately has
 * no notion of specific known relay/ESP domains (e.g. a particular mailing-list
 * provider) - which senders use which ESP is mailbox-specific data, not a
 * generic pattern, so it belongs in the whitelist/blacklist itself (a domain
 * entry there is skipped by `isSenderListed`, not filtered here).
 * @param {string} email
 */
export function isHumanReadable(email) {
  if (!email) return false;
  const [local, domain] = email.split('@');
  if (!local || !domain) return false;

  const localLower = local.toLowerCase();

  // 1. Known bounce/relay patterns in local part
  if (/^(bounce[_\-+]|bounces[+])/.test(localLower)) return false;

  // 2. Tokenized or entropy-heavy local part (long and random)
  if (local.length > 30 && /[a-z]/i.test(local) && /\d/.test(local)) {
    const entropyFactor =
      (local.match(/[a-z0-9]/gi) || []).length / local.length;
    if (entropyFactor > 0.7) return false;
  }

  // 3. Starts with timestamp-like data (e.g., 2025062619..., 2025051718...)
  if (/^20\d{10,}/.test(local)) return false;

  // 4. Multiple dot-separated numeric tokens
  if ((local.match(/\d+\.\d+/g) || []).length >= 2) return false;

  // 5. UUID-like patterns (8-4-4-4-12 hex format with dashes or without)
  if (
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      local
    )
  )
    return false;
  if (/^[a-f0-9]{32,}$/i.test(local)) return false; // Long hex strings

  // 6. Domain checks - only filter obvious relay/bounce subdomains
  const domainLower = domain.toLowerCase();

  // Check for bounce/relay subdomains at the start (more specific than before)
  if (/^(bounces?\.|relay\.|mailer\.)/.test(domainLower)) return false;

  // other cases
  return true;
}

/**
 * Extracts human-relevant sender addresses from parsed headers, for adding to
 * a whitelist/blacklist via training. Skips an address already covered by
 * `listedEntries` (an exact match, or its domain already listed - see
 * `isSenderListed`) so training doesn't re-add what a domain entry already
 * covers.
 * @param {Record<string, string>} headers - Email headers with lowercase keys
 * @param {Set<string>} [listedEntries] - Normalized entries already in the
 *   target list (see `isSenderListed`)
 * @returns {string[]} - Up to 2 clean sender addresses
 */
export function extractSenders(headers, listedEntries = new Set()) {
  const candidates = [];
  const priorityFields = ['from', 'reply-to', 'return-path', 'sender'];

  for (const field of priorityFields) {
    const raw = headers[field];
    if (!raw) continue;

    const parsed = parseOneAddress(raw);
    if (parsed) {
      const address = parsed.address.toLowerCase();
      if (!isHumanReadable(address)) {
        logger.debug(
          { field, email: address },
          'Email address rejected as non-human-readable'
        );
      } else if (isSenderListed(address, listedEntries)) {
        logger.debug(
          { field, email: address },
          'Email address already covered by an existing list entry'
        );
      } else {
        candidates.push(address);
      }
    }
  }

  return [...new Set(candidates)].slice(0, 2);
}

/**
 * Extract sender addresses from a batch of messages, for the map-training
 * workflows (see the `sender-lists` capability).
 * @param {Array} messages - Array of message objects with uid, headers
 * @param {Set<string>} [listedEntries] - Passed through to `extractSenders`
 * @returns {Array<string>} - Array of unique sender email addresses
 */
export function extractSenderAddresses(messages, listedEntries = new Set()) {
  const senders = [];

  for (const message of messages) {
    const { uid, headers } = message;
    const messageLogger = logger.forMessage(uid);
    const messageSenders = extractSenders(headers, listedEntries);

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
 * Checks whether a (normalized) sender address matches an entry in
 * `entrySet` - either an exact address ("bob@example.com") or a domain
 * entry ("@example.com", matching any sender at exactly that domain).
 * Domain entries are added the same way as addresses (e.g. via
 * `import-list.js`) - `normalizeEmail` already accepts the "@domain" form
 * since it contains "@", so no separate storage/parsing path is needed.
 * @param {string|null} address - as returned by senderAddressOf
 * @param {Set<string>} entrySet - whitelist/blacklist entries (addresses and/or domains)
 * @returns {boolean}
 */
export function isSenderListed(address, entrySet) {
  if (!address) return false;
  if (entrySet.has(address)) return true;
  const domain = address.slice(address.lastIndexOf('@'));
  return entrySet.has(domain);
}

/**
 * Splits messages by whether their sender matches an entry in `addressSet`
 * (e.g. a blacklist) - an exact address or a domain entry (see
 * `isSenderListed`) - used by scan.controller.js to route blacklisted
 * senders around rspamd/AI entirely.
 * @param {Array} messages
 * @param {Set<string>} addressSet
 * @returns {{matched: Array, rest: Array}}
 */
export function partitionBySender(messages, addressSet) {
  const matched = [];
  const rest = [];
  for (const message of messages) {
    const sender = senderAddressOf(message);
    (isSenderListed(sender, addressSet) ? matched : rest).push(message);
  }
  return { matched, rest };
}
