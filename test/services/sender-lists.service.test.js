import {
  normalizeEmail,
  senderAddressOf,
  mergeAddresses,
  overrideAddresses,
  parseAddressList,
  serializeAddressList,
  isHumanReadable,
  extractSenders,
  extractSenderAddresses,
  partitionBySender,
} from '../../src/lib/services/sender-lists.service.js';

describe('normalizeEmail', () => {
  test('trims and lowercases', () => {
    expect(normalizeEmail('  Sender@Example.COM  ')).toBe('sender@example.com');
  });

  test('rejects a string with no @', () => {
    expect(normalizeEmail('not-an-address')).toBeNull();
  });

  test('rejects null/undefined/non-string input', () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });

  test('rejects an empty string', () => {
    expect(normalizeEmail('')).toBeNull();
  });
});

describe('senderAddressOf', () => {
  test('reads and normalizes envelope.from[0].address', () => {
    const message = {
      envelope: { from: [{ address: ' Sender@Example.com ' }] },
    };
    expect(senderAddressOf(message)).toBe('sender@example.com');
  });

  test('returns null when envelope.from is missing', () => {
    expect(senderAddressOf({ envelope: {} })).toBeNull();
  });

  test('returns null when envelope.from is an empty array', () => {
    expect(senderAddressOf({ envelope: { from: [] } })).toBeNull();
  });

  test('returns null when envelope itself is missing', () => {
    expect(senderAddressOf({})).toBeNull();
  });
});

describe('mergeAddresses', () => {
  test('unions existing and incoming, normalized', () => {
    const result = mergeAddresses(['a@b.com'], ['C@D.com', 'a@b.com']);
    expect(result).toEqual(['a@b.com', 'c@d.com']);
  });

  test('deduplicates case-insensitively', () => {
    const result = mergeAddresses(['A@B.com'], ['a@b.com']);
    expect(result).toEqual(['a@b.com']);
  });

  test('handles empty existing/incoming', () => {
    expect(mergeAddresses([], [])).toEqual([]);
    expect(mergeAddresses([], ['a@b.com'])).toEqual(['a@b.com']);
    expect(mergeAddresses(['a@b.com'], [])).toEqual(['a@b.com']);
  });

  test('drops unparseable entries from either side', () => {
    const result = mergeAddresses(
      ['a@b.com', 'junk'],
      ['also junk', 'c@d.com']
    );
    expect(result).toEqual(['a@b.com', 'c@d.com']);
  });
});

describe('overrideAddresses', () => {
  test('normalizes and dedupes, ignoring any prior list', () => {
    const result = overrideAddresses(['A@B.com', 'a@b.com', 'c@d.com']);
    expect(result).toEqual(['a@b.com', 'c@d.com']);
  });

  test('drops unparseable entries', () => {
    expect(overrideAddresses(['junk', 'a@b.com'])).toEqual(['a@b.com']);
  });

  test('empty input yields empty list', () => {
    expect(overrideAddresses([])).toEqual([]);
  });
});

describe('parseAddressList', () => {
  test('txt format splits on newlines and normalizes', () => {
    const raw = 'A@B.com\n c@d.com \nnot-an-address\n';
    expect(parseAddressList(raw, 'txt')).toEqual(['a@b.com', 'c@d.com']);
  });

  test('txt is the default format', () => {
    expect(parseAddressList('a@b.com\n')).toEqual(['a@b.com']);
  });

  test('json format parses a JSON array and normalizes each entry', () => {
    const raw = JSON.stringify(['A@B.com', ' c@d.com ']);
    expect(parseAddressList(raw, 'json')).toEqual(['a@b.com', 'c@d.com']);
  });

  test('json format drops non-address entries', () => {
    const raw = JSON.stringify(['a@b.com', 'not-an-address']);
    expect(parseAddressList(raw, 'json')).toEqual(['a@b.com']);
  });

  test('json format throws on invalid JSON', () => {
    expect(() => parseAddressList('not json', 'json')).toThrow();
  });
});

describe('serializeAddressList', () => {
  test('txt format joins with newlines and a trailing newline', () => {
    expect(serializeAddressList(['a@b.com', 'c@d.com'], 'txt')).toBe(
      'a@b.com\nc@d.com\n'
    );
  });

  test('txt is the default format', () => {
    expect(serializeAddressList(['a@b.com'])).toBe('a@b.com\n');
  });

  test('txt format of an empty list is an empty string', () => {
    expect(serializeAddressList([], 'txt')).toBe('');
  });

  test('json format is a pretty-printed JSON array', () => {
    expect(serializeAddressList(['a@b.com'], 'json')).toBe(
      JSON.stringify(['a@b.com'], null, 2)
    );
  });

  test('json format of an empty list is an empty array', () => {
    expect(serializeAddressList([], 'json')).toBe('[]');
  });

  test('round-trips through parseAddressList for both formats', () => {
    const addresses = ['a@b.com', 'c@d.com'];
    expect(
      parseAddressList(serializeAddressList(addresses, 'txt'), 'txt')
    ).toEqual(addresses);
    expect(
      parseAddressList(serializeAddressList(addresses, 'json'), 'json')
    ).toEqual(addresses);
  });
});

describe('isHumanReadable', () => {
  describe('should accept legitimate corporate email addresses', () => {
    test('should accept email addresses with email subdomain', () => {
      expect(isHumanReadable('AmericanExpress@email.americanexpress.com')).toBe(
        true
      );
      expect(isHumanReadable('noreply@email.example.com')).toBe(true);
    });

    test('should accept no-reply addresses from legitimate services', () => {
      expect(isHumanReadable('no-reply@amazonmusic.com')).toBe(true);
      expect(isHumanReadable('noreply@questrade.com')).toBe(true);
      expect(isHumanReadable('info@res-marriott.com')).toBe(true);
      expect(isHumanReadable('updates@primevideo.com')).toBe(true);
    });

    test('should accept standard corporate addresses', () => {
      expect(isHumanReadable('support@company.com')).toBe(true);
      expect(isHumanReadable('info@business.org')).toBe(true);
      expect(isHumanReadable('contact@service.net')).toBe(true);
    });
  });

  describe('should reject bounce and relay addresses', () => {
    test('should reject bounce prefixes in local part', () => {
      expect(isHumanReadable('bounce_12345@example.com')).toBe(false);
      expect(isHumanReadable('bounce-token@example.com')).toBe(false);
      expect(isHumanReadable('bounces+123@example.com')).toBe(false);
    });

    test('should reject domains starting with bounce/relay/mailer', () => {
      expect(isHumanReadable('user@bounces.example.com')).toBe(false);
      expect(isHumanReadable('user@bounce.example.com')).toBe(false);
      expect(isHumanReadable('user@relay.example.com')).toBe(false);
      expect(isHumanReadable('user@mailer.example.com')).toBe(false);
    });

    test('should reject known relay domains', () => {
      expect(isHumanReadable('anything@lnk01.com')).toBe(false);
      expect(isHumanReadable('token@cyberimpact.com')).toBe(false);
    });
  });

  describe('should reject tokenized addresses', () => {
    test('should reject long high-entropy addresses', () => {
      expect(
        isHumanReadable('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9@example.com')
      ).toBe(false);
    });

    test('should reject UUID patterns', () => {
      expect(
        isHumanReadable('550e8400-e29b-41d4-a716-446655440000@example.com')
      ).toBe(false);
    });

    test('should reject long hex strings', () => {
      expect(
        isHumanReadable('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@example.com')
      ).toBe(false);
    });

    test('should reject timestamp-prefixed addresses', () => {
      expect(isHumanReadable('202506261912345@example.com')).toBe(false);
    });

    test('should reject addresses with multiple dot-separated numeric tokens', () => {
      expect(isHumanReadable('123.456.abc.789.012@example.com')).toBe(false);
    });
  });

  describe('should handle edge cases', () => {
    test('should reject empty or invalid emails', () => {
      expect(isHumanReadable('')).toBe(false);
      expect(isHumanReadable(null)).toBe(false);
      expect(isHumanReadable(undefined)).toBe(false);
      expect(isHumanReadable('notanemail')).toBe(false);
      expect(isHumanReadable('@example.com')).toBe(false);
      expect(isHumanReadable('user@')).toBe(false);
    });
  });
});

describe('extractSenders', () => {
  test('should extract multiple senders from From, Reply-To, and Return-Path headers', () => {
    const headers = {
      from: 'John Doe <john@example.com>',
      'reply-to': 'Jane Smith <jane@example.com>',
      'return-path': '<bob@example.com>',
      to: 'recipient@example.com',
      subject: 'Test Email',
    };

    expect(extractSenders(headers)).toEqual([
      'john@example.com',
      'jane@example.com',
    ]);
  });

  test('should extract sender from Reply-To header if From is missing', () => {
    const headers = {
      'reply-to': 'John Doe <john@example.com>',
      to: 'recipient@example.com',
    };

    expect(extractSenders(headers)).toEqual(['john@example.com']);
  });

  test('should extract sender from Return-Path header if From and Reply-To are missing', () => {
    const headers = {
      'return-path': '<john@example.com>',
      to: 'recipient@example.com',
    };

    expect(extractSenders(headers)).toEqual(['john@example.com']);
  });

  test('should return empty array if no sender headers are present', () => {
    expect(extractSenders({ to: 'recipient@example.com' })).toEqual([]);
  });

  test('should filter out non-human-readable email addresses', () => {
    const headers = {
      from: 'bounce_12345@example.com',
      'reply-to': 'John Doe <john@example.com>',
      to: 'recipient@example.com',
    };

    expect(extractSenders(headers)).toEqual(['john@example.com']);
  });

  test('should accept legitimate corporate senders previously rejected', () => {
    const headers = {
      from: 'AmericanExpress <AmericanExpress@email.americanexpress.com>',
      'return-path': '<AmericanExpress@email.americanexpress.com>',
      to: 'user@example.com',
    };

    expect(extractSenders(headers)).toEqual([
      'americanexpress@email.americanexpress.com',
    ]);
  });

  test('should return up to 2 unique senders', () => {
    const headers = {
      from: 'John Doe <john@example.com>',
      'reply-to': 'Jane Smith <jane@example.com>',
      'return-path': '<support@example.com>',
      sender: 'Admin <admin@example.com>',
    };

    const senders = extractSenders(headers);

    expect(senders.length).toBe(2);
    expect(senders).toContain('john@example.com');
    expect(senders).toContain('jane@example.com');
  });
});

describe('extractSenderAddresses', () => {
  test('should extract senders from message headers', () => {
    const messages = [
      {
        uid: 1,
        headers: {
          from: 'John Doe <john@example.com>',
          'reply-to': 'jane@example.com',
        },
      },
      { uid: 2, headers: { from: 'Alice <alice@example.com>' } },
    ];

    const result = extractSenderAddresses(messages);

    expect(result).toContain('john@example.com');
    expect(result).toContain('alice@example.com');
  });

  test('should return unique senders', () => {
    const messages = [
      { uid: 1, headers: { from: 'john@example.com' } },
      { uid: 2, headers: { from: 'john@example.com' } },
    ];

    expect(
      extractSenderAddresses(messages).filter(e => e === 'john@example.com')
    ).toHaveLength(1);
  });

  test('should handle messages with no extractable senders', () => {
    expect(extractSenderAddresses([{ uid: 1, headers: {} }])).toEqual([]);
  });

  test('should handle empty message array', () => {
    expect(extractSenderAddresses([])).toEqual([]);
  });

  test('should filter non-human-readable addresses', () => {
    const messages = [
      { uid: 1, headers: { from: 'bounce+token123456@example.com' } },
      { uid: 2, headers: { from: 'real-person@example.com' } },
    ];

    const result = extractSenderAddresses(messages);

    expect(result).toContain('real-person@example.com');
    expect(result).not.toContain('bounce+token123456@example.com');
  });
});

describe('partitionBySender', () => {
  test('splits messages by whether their sender address is in the set', () => {
    const messages = [
      { envelope: { from: [{ address: 'bad@evil.com' }] } },
      { envelope: { from: [{ address: 'ok@example.com' }] } },
    ];

    const { matched, rest } = partitionBySender(
      messages,
      new Set(['bad@evil.com'])
    );

    expect(matched).toEqual([messages[0]]);
    expect(rest).toEqual([messages[1]]);
  });

  test('a message with no sender address never matches', () => {
    const messages = [{ envelope: {} }];
    const { matched, rest } = partitionBySender(messages, new Set(['x@y.com']));
    expect(matched).toEqual([]);
    expect(rest).toEqual(messages);
  });
});
