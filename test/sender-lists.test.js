import {
  normalizeEmail,
  senderAddressOf,
  mergeAddresses,
  overrideAddresses,
  parseAddressList,
  serializeAddressList,
} from '../src/lib/utils/sender-lists.js';

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
