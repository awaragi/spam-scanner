/**
 * Domain rules for whitelist/blacklist sender-address normalization,
 * matching, and extraction, keyed on the address rspamd's own multimap
 * rules used to match on (the message's From address) - see the
 * `sender-lists` capability. Pure, never sees `ctx`.
 */
import emailAddresses from 'email-addresses';
import { rootLogger } from '../core/logger.ts';

const { parseOneAddress } = emailAddresses;
const logger = rootLogger.forComponent('sender-lists');

interface EnvelopeAddressed {
  envelope?: { from?: Array<{ address?: string }> };
}

/**
 * Normalize an email address: trim, lowercase. Returns null for anything
 * that isn't a plausible address (no `@`), so callers can filter it out.
 * @param email
 */
export function normalizeEmail(email: unknown): string | null {
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
 * @param message - Message object with an `envelope` property
 * @returns - Normalized sender address, or null if absent
 */
export function senderAddressOf(message: EnvelopeAddressed): string | null {
  const address = message?.envelope?.from?.[0]?.address;
  return normalizeEmail(address);
}

/**
 * Merges normalized, deduplicated incoming addresses into an existing list.
 * @param existing
 * @param incoming
 * @returns - Deduplicated union, existing entries first
 */
const isString = (value: string | null): value is string => value !== null;

export function mergeAddresses(existing: string[], incoming: string[]) {
  const normalizedExisting = existing.map(normalizeEmail).filter(isString);
  const normalizedIncoming = incoming.map(normalizeEmail).filter(isString);

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
 * @param incoming
 */
export function overrideAddresses(incoming: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

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
 * @param raw
 * @param [format]
 */
export function parseAddressList(
  raw: string,
  format: 'txt' | 'json' = 'txt'
): string[] {
  const rawAddresses: unknown[] =
    format === 'json' ? JSON.parse(raw) : raw.split('\n');
  return rawAddresses.map(normalizeEmail).filter(isString);
}

/**
 * Serializes a list of (already normalized) addresses for the export
 * script. `txt` is one address per line; `json` is the raw array,
 * pretty-printed.
 * @param addresses
 * @param [format]
 */
export function serializeAddressList(
  addresses: string[],
  format: 'txt' | 'json' = 'txt'
): string {
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
 * @param email
 */
export function isHumanReadable(email: unknown): boolean {
  if (!email || typeof email !== 'string') return false;
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
 * @param headers - Email headers with lowercase keys
 * @param [listedEntries] - Normalized entries already in the
 *   target list (see `isSenderListed`)
 * @returns - Up to 2 clean sender addresses
 */
export function extractSenders(
  headers: Record<string, string>,
  listedEntries: Set<string> = new Set()
): string[] {
  const candidates: string[] = [];
  const priorityFields = ['from', 'reply-to', 'return-path', 'sender'];

  for (const field of priorityFields) {
    const raw = headers[field];
    if (!raw) continue;

    const parsed = parseOneAddress(raw);
    if (parsed && parsed.type === 'mailbox') {
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
 * @param messages - Array of message objects with uid, headers
 * @param [listedEntries] - Passed through to `extractSenders`
 * @returns - Array of unique sender email addresses
 */
interface HeaderedMessage {
  uid: number;
  headers: Record<string, string>;
}

export function extractSenderAddresses(
  messages: HeaderedMessage[],
  listedEntries: Set<string> = new Set()
): string[] {
  const senders: string[] = [];

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
 * @param address - as returned by senderAddressOf
 * @param entrySet - whitelist/blacklist entries (addresses and/or domains)
 */
export function isSenderListed(
  address: string | null,
  entrySet: Set<string>
): boolean {
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
 * @param messages
 * @param addressSet
 */
export function partitionBySender<M extends EnvelopeAddressed>(
  messages: M[],
  addressSet: Set<string>
): { matched: M[]; rest: M[] } {
  const matched: M[] = [];
  const rest: M[] = [];
  for (const message of messages) {
    const sender = senderAddressOf(message);
    (isSenderListed(sender, addressSet) ? matched : rest).push(message);
  }
  return { matched, rest };
}
