import { describe, test, expect, vi } from 'vitest';

vi.mock('../../domain/utils/email-parser.js', () => ({
  stripSpamHeadersBuffer: vi.fn((buffer: Buffer) => {
    // Mock implementation: strip lines starting with X-Spam-
    const str = buffer.toString('latin1');
    const lines = str.split('\n');
    const filtered = lines.filter(
      line => !line.toLowerCase().startsWith('x-spam-')
    );
    return Buffer.from(filtered.join('\n'), 'latin1');
  }),
  parseEmail: vi.fn((content: string) => {
    // Mock implementation: simple header parsing
    const match = content.match(/^([\s\S]*?)\r?\n\r?\n([\s\S]*)$/);
    if (!match) {
      return { headers: {}, body: content };
    }
    const headerText = match[1];
    const body = match[2];
    const headers: Record<string, string> = {};
    for (const line of headerText.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > -1) {
        const key = line.slice(0, colonIdx).trim().toLowerCase();
        const value = line.slice(colonIdx + 1).trim();
        headers[key] = value;
      }
    }
    return { headers, body };
  }),
}));

import {
  processMessage,
  processMessageHeaders,
} from './message.mapper.js';
import * as emailParser from '../../domain/utils/email-parser.js';

describe('processMessage', () => {
  test('returns raw as a Buffer with X-Spam headers stripped', () => {
    const source = Buffer.from(
      'From: a@example.com\nX-Spam-Flag: YES\n\nBody',
      'latin1'
    );
    const message = {
      uid: 5,
      flags: ['\\Seen'],
      envelope: { subject: 'hi' },
      source,
    };

    const result = processMessage(message);

    expect(Buffer.isBuffer(result.raw)).toBe(true);
    expect(result).toEqual({
      uid: 5,
      flags: ['\\Seen'],
      envelope: { subject: 'hi' },
      raw: expect.any(Buffer),
    });
    expect(emailParser.stripSpamHeadersBuffer).toHaveBeenCalledWith(source);
  });

  test('preserves non-UTF-8 8-bit body bytes rather than corrupting them', () => {
    const header = Buffer.from('Subject: hi\r\n\r\n', 'latin1');
    const body = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "caf" + invalid-UTF-8 0xE9
    const source = Buffer.concat([header, body]);
    const message = {
      uid: 6,
      flags: [],
      envelope: {},
      source,
    };

    const result = processMessage(message);

    expect(Buffer.isBuffer(result.raw)).toBe(true);
    expect(result.uid).toBe(6);
  });
});

describe('processMessageHeaders', () => {
  test('parses headers from a header buffer that already ends in a blank line', () => {
    const message = {
      uid: 1,
      headers: Buffer.from('From: a@example.com\r\nSubject: hi\r\n\r\n'),
    };

    const result = processMessageHeaders(message);

    expect(result).toEqual({
      uid: 1,
      headers: expect.objectContaining({
        from: 'a@example.com',
        subject: 'hi',
      }),
    });
    expect(emailParser.parseEmail).toHaveBeenCalledWith(
      'From: a@example.com\r\nSubject: hi\r\n\r\n\r\n\r\n'
    );
  });

  test('parses headers from a header buffer with no trailing blank line', () => {
    // Some servers' BODY[HEADER] response omits the trailing CRLFCRLF -
    // processMessageHeaders must still find the header/body boundary.
    const message = {
      uid: 2,
      headers: Buffer.from('From: b@example.com\r\nSubject: bye'),
    };

    const result = processMessageHeaders(message);

    expect(result).toEqual({
      uid: 2,
      headers: expect.objectContaining({
        from: 'b@example.com',
        subject: 'bye',
      }),
    });
    expect(emailParser.parseEmail).toHaveBeenCalledWith(
      'From: b@example.com\r\nSubject: bye\r\n\r\n'
    );
  });
});
