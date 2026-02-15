import {
  extractDateFromRaw,
  extractHeaders, parseEmail,
  parseSpamAssassinOutput,
  parseRspamdOutput,
  stripSpamHeaders
} from '../src/lib/utils/email-parser.js';

describe('stripSpamHeaders', () => {
  test('should remove X-Spam headers', () => {
    const input = `From: test@example.com
To: recipient@example.com
Subject: Test Email
X-Spam-Status: Yes, score=5.0 required=5.0
X-Spam-Flag: YES
Content-Type: text/plain

This is a test email.`;

    const expected = `From: test@example.com
To: recipient@example.com
Subject: Test Email
Content-Type: text/plain

This is a test email.`;

    expect(stripSpamHeaders(input)).toBe(expected);
  });

  test('should remove X-Ham-Report headers', () => {
    const input = `From: test@example.com
To: recipient@example.com
Subject: Test Email
X-Ham-Report: DKIM_SIGNED=0.1 DKIM_VALID=-0.1
Content-Type: text/plain

This is a test email.`;

    const expected = `From: test@example.com
To: recipient@example.com
Subject: Test Email
Content-Type: text/plain

This is a test email.`;

    expect(stripSpamHeaders(input)).toBe(expected);
  });

  test('should handle multi-line headers', () => {
    const input = `From: test@example.com
To: recipient@example.com
Subject: Test Email
X-Spam-Status: Yes, score=5.0 required=5.0
 tests=TEST1,TEST2
 autolearn=no
Content-Type: text/plain

This is a test email.`;

    const expected = `From: test@example.com
To: recipient@example.com
Subject: Test Email
Content-Type: text/plain

This is a test email.`;

    expect(stripSpamHeaders(input)).toBe(expected);
  });
});

describe('extractDateFromRaw', () => {
  test('should extract date from email', () => {
    const input = `From: test@example.com
To: recipient@example.com
Subject: Test Email
Date: Mon, 15 May 2023 10:30:00 +0000
Content-Type: text/plain

This is a test email.`;

    const date = extractDateFromRaw(input);
    expect(date).toBe(new Date('Mon, 15 May 2023 10:30:00 +0000').toISOString());
  });

  test('should return null for invalid date', () => {
    const input = `From: test@example.com
To: recipient@example.com
Subject: Test Email
Date: Invalid Date
Content-Type: text/plain

This is a test email.`;

    const date = extractDateFromRaw(input);
    expect(date).toBeNull();
  });

  test('should return null if no date is found', () => {
    const input = `From: test@example.com
To: recipient@example.com
Subject: Test Email
Content-Type: text/plain

This is a test email.`;

    const date = extractDateFromRaw(input);
    expect(date).toBeNull();
  });
});

describe('parse', () => {
  test('should parse headers and body from raw email', () => {
    const rawEmail = `From: test@example.com
To: recipient@example.com
Subject: Test Email
Date: Mon, 15 May 2023 10:30:00 +0000
Content-Type: text/plain

This is a test email.`;

    const parsed = parseEmail(rawEmail);

    expect(parsed).toEqual({
      headers: {
        'from': 'test@example.com',
        'to': 'recipient@example.com',
        'subject': 'Test Email',
        'date': 'Mon, 15 May 2023 10:30:00 +0000',
        'content-type': 'text/plain'
      },
      body: 'This is a test email.'
    });
  });

  test('should handle multi-line headers', () => {
    const rawEmail = `From: test@example.com
To: recipient@example.com
Subject: Test Email
X-Custom-Header: This is a long header
 that spans multiple lines
 with indentation
Date: Mon, 15 May 2023 10:30:00 +0000

This is a test email.`;

    const parsed = parseEmail(rawEmail);

    expect(parsed.headers['x-custom-header']).toBe('This is a long header that spans multiple lines with indentation');
  });

  test('should return empty headers for invalid input', () => {
    const rawEmail = 'This is not a valid email';
    const parsed = parseEmail(rawEmail);

    expect(parsed).toEqual({
      headers: {},
      body: 'This is not a valid email'
    });
  });
});

describe('parseSpamAssassinOutput', () => {
  test('should parse SpamAssassin output with spam', () => {
    const headers = {
      'from': 'test@example.com',
      'to': 'recipient@example.com',
      'subject': '[SPAM] Test Email',
      'x-spam-status': 'Yes, score=8.5 required=5.0',
      'x-spam-level': '********',
      'x-spam-flag': 'YES',
      'content-type': 'text/plain'
    };

    const result = parseSpamAssassinOutput(headers);
    expect(result).toEqual({
      score: 8.5,
      level: 8,
      required: 5.0,
      isSpam: true,
    });
  });

  test('should parse SpamAssassin output without spam', () => {
    const headers = {
      'from': 'test@example.com',
      'to': 'recipient@example.com',
      'subject': 'Test Email',
      'x-spam-status': 'No, score=0.5 required=5.0',
      'x-spam-level': '',
      'content-type': 'text/plain'
    };

    const result = parseSpamAssassinOutput(headers);
    expect(result).toEqual({
      score: 0.5,
      level: 0,
      required: 5.0,
      isSpam: false
    });
  });

  test('should handle missing fields', () => {
    const headers = {
      'from': 'test@example.com',
      'to': 'recipient@example.com',
      'content-type': 'text/plain'
    };

    const result = parseSpamAssassinOutput(headers);
    expect(result).toEqual({
      score: null,
      level: 0,
      required: null,
      isSpam: false
    });
  });

  test('should handle missing x-spam-flag', () => {
    const headers = {
      'x-spam-status': 'No, score=2.1 required=5.0',
      'x-spam-level': '**'
    };

    const result = parseSpamAssassinOutput(headers);
    expect(result).toEqual({
      score: 2.1,
      level: 2,
      required: 5.0,
      isSpam: false
    });
  });

  test('should handle negative spam scores', () => {
    const headers = {
      'x-spam-status': 'No, score=-2.3 required=5.0',
      'x-spam-level': '',
      'x-spam-flag': 'NO'
    };

    const result = parseSpamAssassinOutput(headers);
    expect(result).toEqual({
      score: -2.3,
      level: 0,
      required: 5.0,
      isSpam: false
    });
  });
});

describe('parseRspamdOutput', () => {
  test('should parse Rspamd response with spam action', () => {
    const response = {
      action: 'add header',
      score: 8.5,
      required_score: 10.0,
      symbols: {
        TEST_SYMBOL: { score: 2.5 }
      }
    };

    const result = parseRspamdOutput(response);
    expect(result).toEqual({
      score: 8.5,
      required: 10.0,
      level: null,
      isSpam: true
    });
  });

  test('should parse Rspamd response with reject action', () => {
    const response = {
      action: 'reject',
      score: 15.0,
      required_score: 10.0,
      symbols: {}
    };

    const result = parseRspamdOutput(response);
    expect(result).toEqual({
      score: 15.0,
      required: 10.0,
      level: null,
      isSpam: true
    });
  });

  test('should parse Rspamd response with no action (not spam)', () => {
    const response = {
      action: 'no action',
      score: 0.5,
      required_score: 10.0,
      symbols: {}
    };

    const result = parseRspamdOutput(response);
    expect(result).toEqual({
      score: 0.5,
      required: 10.0,
      level: null,
      isSpam: false
    });
  });

  test('should parse Rspamd response with greylist action', () => {
    const response = {
      action: 'greylist',
      score: 7.0,
      required_score: 10.0,
      symbols: {}
    };

    const result = parseRspamdOutput(response);
    expect(result).toEqual({
      score: 7.0,
      required: 10.0,
      level: null,
      isSpam: false
    });
  });

  test('should handle missing fields with defaults', () => {
    const response = {};

    const result = parseRspamdOutput(response);
    expect(result).toEqual({
      score: 0,
      required: 0,
      level: null,
      isSpam: false
    });
  });

  test('should handle null action field', () => {
    const response = {
      action: null,
      score: 5.0,
      required_score: 10.0
    };

    const result = parseRspamdOutput(response);
    expect(result).toEqual({
      score: 5.0,
      required: 10.0,
      level: null,
      isSpam: false
    });
  });

  test('should throw error for non-object response', () => {
    expect(() => parseRspamdOutput('invalid')).toThrow('Invalid Rspamd response format');
  });

  test('should throw error for null response', () => {
    expect(() => parseRspamdOutput(null)).toThrow('Invalid Rspamd response format');
  });
});