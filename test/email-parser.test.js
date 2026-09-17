import {
  extractDateFromRaw,
  extractHeaders, parseEmail,
  parseSpamAssassinOutput,
  parseRspamdOutput,
  parseAiClassificationOutput,
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
      isSpam: true,
      isWhitelisted: false
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
      isSpam: true,
      isWhitelisted: false
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
      isSpam: false,
      isWhitelisted: false
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
      isSpam: false,
      isWhitelisted: false
    });
  });

  test('should handle missing fields with defaults', () => {
    const response = {};

    const result = parseRspamdOutput(response);
    expect(result).toEqual({
      score: 0,
      required: 0,
      level: null,
      isSpam: false,
      isWhitelisted: false
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
      isSpam: false,
      isWhitelisted: false
    });
  });

  test('should detect a whitelist match via the WHITELIST_EMAIL symbol', () => {
    const response = {
      action: 'no action',
      score: -18.0,
      required_score: 10.0,
      symbols: {
        WHITELIST_EMAIL: { score: -20 }
      }
    };

    const result = parseRspamdOutput(response);
    expect(result.isWhitelisted).toBe(true);
  });

  test('should not flag isWhitelisted when other symbols fire but not WHITELIST_EMAIL', () => {
    const response = {
      action: 'no action',
      score: 2.0,
      required_score: 10.0,
      symbols: {
        SOME_OTHER_SYMBOL: { score: 2.0 }
      }
    };

    const result = parseRspamdOutput(response);
    expect(result.isWhitelisted).toBe(false);
  });

  test('should throw error for non-object response', () => {
    expect(() => parseRspamdOutput('invalid')).toThrow('Invalid Rspamd response format');
  });

  test('should throw error for null response', () => {
    expect(() => parseRspamdOutput(null)).toThrow('Invalid Rspamd response format');
  });
});

describe('parseAiClassificationOutput', () => {
  test('should parse a valid JSON response', () => {
    const result = parseAiClassificationOutput('{"score": 42, "reasoning": "Looks borderline"}');
    expect(result).toEqual({score: 42, reasoning: 'Looks borderline'});
  });

  test('should parse a response fenced with ```json', () => {
    const content = '```json\n{"score": 85, "reasoning": "Phishing link"}\n```';
    expect(parseAiClassificationOutput(content)).toEqual({score: 85, reasoning: 'Phishing link'});
  });

  test('should parse a response fenced with plain ``` (no json tag)', () => {
    const content = '```\n{"score": 10, "reasoning": "Clean"}\n```';
    expect(parseAiClassificationOutput(content)).toEqual({score: 10, reasoning: 'Clean'});
  });

  test('should clamp a score above 100', () => {
    const result = parseAiClassificationOutput('{"score": 150, "reasoning": "Very spammy"}');
    expect(result.score).toBe(100);
  });

  test('should clamp a score below 0', () => {
    const result = parseAiClassificationOutput('{"score": -20, "reasoning": "Negative"}');
    expect(result.score).toBe(0);
  });

  test('should throw when score is missing', () => {
    expect(() => parseAiClassificationOutput('{"reasoning": "No score here"}')).toThrow(/missing numeric "score"/);
  });

  test('should throw when score is not a number', () => {
    expect(() => parseAiClassificationOutput('{"score": "high", "reasoning": "bad type"}')).toThrow(/missing numeric "score"/);
  });

  test('should default reasoning to an empty string when missing', () => {
    const result = parseAiClassificationOutput('{"score": 30}');
    expect(result).toEqual({score: 30, reasoning: ''});
  });

  test('should throw on non-JSON garbage input', () => {
    expect(() => parseAiClassificationOutput('not json at all')).toThrow(/not valid JSON/);
  });

  test('should throw on empty content', () => {
    expect(() => parseAiClassificationOutput('')).toThrow('AI response content is empty');
  });

  test('should throw on null content', () => {
    expect(() => parseAiClassificationOutput(null)).toThrow('AI response content is empty');
  });
});