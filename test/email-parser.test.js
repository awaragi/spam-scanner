import { stripSpamHeaders, extractDateFromRaw, parseSpamAssassinOutput } from '../src/lib/utils/email-parser.js';

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

describe('parseSpamAssassinOutput', () => {
  test('should parse SpamAssassin output with spam', () => {
    const input = `From: test@example.com
To: recipient@example.com
Subject: [SPAM] Test Email
X-Spam-Status: Yes, score=8.5 required=5.0
X-Spam-Level: ********
X-Spam-Flag: YES
Content-Type: text/plain

This is a test email.`;

    const result = parseSpamAssassinOutput(input);
    expect(result).toEqual({
      score: 8.5,
      level: 8,
      isSpam: true,
      subject: '[SPAM] Test Email'
    });
  });

  test('should parse SpamAssassin output without spam', () => {
    const input = `From: test@example.com
To: recipient@example.com
Subject: Test Email
X-Spam-Status: No, score=0.5 required=5.0
X-Spam-Level: 
Content-Type: text/plain

This is a test email.`;

    const result = parseSpamAssassinOutput(input);
    expect(result).toEqual({
      score: 0.5,
      level: 0,
      isSpam: false,
      subject: 'Test Email'
    });
  });

  test('should handle missing fields', () => {
    const input = `From: test@example.com
To: recipient@example.com
Content-Type: text/plain

This is a test email.`;

    const result = parseSpamAssassinOutput(input);
    expect(result).toEqual({
      score: null,
      level: 0,
      isSpam: false,
      subject: ''
    });
  });
});