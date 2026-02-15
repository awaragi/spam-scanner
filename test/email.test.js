import { extractSenders, dateToString, isHumanReadable } from '../src/lib/utils/email.js';

describe('isHumanReadable', () => {
  describe('should accept legitimate corporate email addresses', () => {
    test('should accept email addresses with email subdomain', () => {
      expect(isHumanReadable('AmericanExpress@email.americanexpress.com')).toBe(true);
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
      // Long address (>30 chars) with high mix of letters and numbers
      expect(isHumanReadable('a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9@example.com')).toBe(false);
    });

    test('should reject UUID patterns', () => {
      expect(isHumanReadable('550e8400-e29b-41d4-a716-446655440000@example.com')).toBe(false);
    });

    test('should reject long hex strings', () => {
      expect(isHumanReadable('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4@example.com')).toBe(false);
    });

    test('should reject timestamp-prefixed addresses', () => {
      expect(isHumanReadable('202506261912345@example.com')).toBe(false);
    });

    test('should reject addresses with multiple dot-separated numeric tokens', () => {
      // Must have at least 2 occurrences of "number.number" pattern
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
      'from': 'John Doe <john@example.com>',
      'reply-to': 'Jane Smith <jane@example.com>',
      'return-path': '<bob@example.com>',
      'to': 'recipient@example.com',
      'subject': 'Test Email'
    };

    const senders = extractSenders(headers);

    expect(senders).toEqual(['john@example.com', 'jane@example.com']);
  });

  test('should extract sender from Reply-To header if From is missing', () => {
    const headers = {
      'reply-to': 'John Doe <john@example.com>',
      'to': 'recipient@example.com',
      'subject': 'Test Email'
    };

    const senders = extractSenders(headers);

    expect(senders).toEqual(['john@example.com']);
  });

  test('should extract sender from Return-Path header if From and Reply-To are missing', () => {
    const headers = {
      'return-path': '<john@example.com>',
      'to': 'recipient@example.com',
      'subject': 'Test Email'
    };

    const senders = extractSenders(headers);

    expect(senders).toEqual(['john@example.com']);
  });

  test('should return empty array if no sender headers are present', () => {
    const headers = {
      'to': 'recipient@example.com',
      'subject': 'Test Email'
    };

    const senders = extractSenders(headers);

    expect(senders).toEqual([]);
  });

  test('should filter out non-human-readable email addresses', () => {
    const headers = {
      'from': 'bounce_12345@example.com',
      'reply-to': 'John Doe <john@example.com>',
      'to': 'recipient@example.com'
    };

    const senders = extractSenders(headers);

    // The bounce email should be filtered out, leaving only the reply-to
    expect(senders).toEqual(['john@example.com']);
  });

  test('should accept legitimate corporate senders previously rejected', () => {
    const headers = {
      'from': 'AmericanExpress <AmericanExpress@email.americanexpress.com>',
      'return-path': '<AmericanExpress@email.americanexpress.com>',
      'to': 'user@example.com'
    };

    const senders = extractSenders(headers);

    // Should accept this legitimate corporate sender
    expect(senders).toEqual(['americanexpress@email.americanexpress.com']);
  });

  test('should accept no-reply addresses from legitimate services', () => {
    const headers = {
      'from': 'no-reply@amazonmusic.com',
      'to': 'user@example.com'
    };

    const senders = extractSenders(headers);

    expect(senders).toEqual(['no-reply@amazonmusic.com']);
  });

  test('should return up to 2 unique senders', () => {
    const headers = {
      'from': 'John Doe <john@example.com>',
      'reply-to': 'Jane Smith <jane@example.com>',
      'return-path': '<support@example.com>',
      'sender': 'Admin <admin@example.com>'
    };

    const senders = extractSenders(headers);

    // Should return the first 2 unique senders
    expect(senders.length).toBe(2);
    expect(senders).toContain('john@example.com');
    expect(senders).toContain('jane@example.com');
  });
});
