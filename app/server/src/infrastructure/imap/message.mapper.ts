import { stripSpamHeadersBuffer, parseEmail } from '../../domain/utils/email-parser.js';

/**
 * Helper function to handle message fetching common code. Keeps `raw` as a
 * Buffer (ImapFlow's own `message.source` type) rather than decoding it to a
 * string, so a non-UTF-8 8-bit body (legacy Latin-1 mail) reaches rspamd/AI
 * classification byte-for-byte instead of getting UTF-8 replacement
 * characters baked in - see `stripSpamHeadersBuffer`.
 * @param message - The message object from ImapFlow
 */
interface RawMessage {
  uid: number;
  flags?: unknown;
  envelope?: unknown;
  source?: Buffer;
}

export function processMessage(message: RawMessage): {
  uid: number;
  flags: unknown;
  envelope: unknown;
  raw: Buffer;
} {
  const { uid, flags, envelope } = message;
  const raw = stripSpamHeadersBuffer(message.source!);

  return {
    uid,
    flags,
    envelope,
    raw,
  };
}

/**
 * Helper function to handle headers-only message fetching - for callers (map
 * training) that only need `uid`/`headers`, never the source or body, so a
 * much cheaper `BODY[HEADER]` fetch suffices instead of a full `BODY[]` one.
 * `parseEmail` splits on the first blank line it finds to separate headers
 * from body; a headers-only fetch has no body and so may have no trailing
 * blank line, so one is appended here - a no-op if the fetched header block
 * already ends in one, and otherwise what makes `parseEmail` find the
 * boundary at all rather than treating the whole buffer as bodyless content.
 * @param message - The message object from ImapFlow (fetched with `headers: true`)
 */
interface HeaderMessage {
  uid: number;
  headers?: Buffer;
}

export function processMessageHeaders(message: HeaderMessage): {
  uid: number;
  headers: Record<string, string>;
} {
  const { uid, headers: headerBuffer } = message;
  const { headers } = parseEmail(`${headerBuffer!.toString()}\r\n\r\n`);

  return { uid, headers };
}
