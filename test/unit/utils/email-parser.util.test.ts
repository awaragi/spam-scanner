import {
  parseEmail,
  parseRspamdOutput,
  parseAiClassificationOutput,
  stripSpamHeaders,
  stripSpamHeadersBuffer,
  parseReceivedHeader,
  resolveConnectingHop,
} from '../../../src/lib/utils/email-parser.util.ts';

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

  test('leaves a body line starting with "x-spam-" untouched', () => {
    const input = `From: test@example.com
To: recipient@example.com
Subject: Test Email
X-Spam-Status: Yes, score=5.0 required=5.0
Content-Type: text/plain

x-spam-status is not a real header down here, just body text.`;

    const expected = `From: test@example.com
To: recipient@example.com
Subject: Test Email
Content-Type: text/plain

x-spam-status is not a real header down here, just body text.`;

    expect(stripSpamHeaders(input)).toBe(expected);
  });
});

describe('stripSpamHeadersBuffer', () => {
  test('removes X-Spam headers the same way as the string version', () => {
    const content = `From: test@example.com
X-Spam-Flag: YES
Subject: Test

Body text.`;

    const result = stripSpamHeadersBuffer(Buffer.from(content, 'latin1'));

    expect(result.toString('latin1')).toBe(stripSpamHeaders(content));
  });

  test('preserves non-UTF-8 8-bit body bytes untouched', () => {
    // 0xE9 alone is invalid UTF-8 (a lone continuation-less lead byte) but a
    // valid Latin-1 byte ("é") - decoding as UTF-8 would replace it with
    // U+FFFD, changing the byte the body sends to rspamd.
    const header = Buffer.from('Subject: Test\r\n\r\n', 'latin1');
    const body = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "caf" + 0xE9
    const input = Buffer.concat([header, body]);

    const result = stripSpamHeadersBuffer(input);
    const resultBody = result.subarray(result.length - body.length);

    expect(Buffer.compare(resultBody, body)).toBe(0);
  });

  test('returns a Buffer, not a string', () => {
    const input = Buffer.from('Subject: Test\r\n\r\nBody', 'latin1');
    expect(Buffer.isBuffer(stripSpamHeadersBuffer(input))).toBe(true);
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
        from: 'test@example.com',
        to: 'recipient@example.com',
        subject: 'Test Email',
        date: 'Mon, 15 May 2023 10:30:00 +0000',
        'content-type': 'text/plain',
      },
      body: 'This is a test email.',
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

    expect(parsed.headers['x-custom-header']).toBe(
      'This is a long header that spans multiple lines with indentation'
    );
  });

  test('should return empty headers for invalid input', () => {
    const rawEmail = 'This is not a valid email';
    const parsed = parseEmail(rawEmail);

    expect(parsed).toEqual({
      headers: {},
      body: 'This is not a valid email',
    });
  });
});

describe('parseReceivedHeader', () => {
  test('extracts HELO and IP from a standard Postfix-style header', () => {
    const value =
      'from mail.example.com (unknown [203.0.113.5]) by mx.provider.com (Postfix) with ESMTPS id ABC123';

    expect(parseReceivedHeader(value)).toEqual({
      ip: '203.0.113.5',
      helo: 'mail.example.com',
    });
  });

  test('extracts an IPv6 address', () => {
    const value =
      'from mail.example.com (unknown [2001:db8::1]) by mx.provider.com';

    expect(parseReceivedHeader(value)).toEqual({
      ip: '2001:db8::1',
      helo: 'mail.example.com',
    });
  });

  test('returns helo with a null ip when no bracketed address is present', () => {
    const value = 'from mail.example.com by mx.provider.com';

    expect(parseReceivedHeader(value)).toEqual({
      ip: null,
      helo: 'mail.example.com',
    });
  });

  test('returns null for a value with no recognizable "from" clause', () => {
    expect(parseReceivedHeader('by mx.provider.com with ESMTP')).toBeNull();
  });

  test('returns null for an empty value', () => {
    expect(parseReceivedHeader('')).toBeNull();
    expect(parseReceivedHeader(null)).toBeNull();
  });
});

describe('resolveConnectingHop', () => {
  // As returned by mailparser's `headers.get('received')`, normalized to an
  // array - topmost (most recent) first.
  const receivedHeaders = [
    'from internal-relay.example.com (internal-relay.example.com [10.0.0.5]) by store.example.com (Dovecot) with LMTP id XYZ',
    'from sender.attacker.example (unknown [203.0.113.9]) by internal-relay.example.com (Postfix) with ESMTPS id ABC123',
  ];

  test('reads the topmost Received header at trustedHops=0', () => {
    expect(resolveConnectingHop(receivedHeaders, 0)).toEqual({
      ip: '10.0.0.5',
      helo: 'internal-relay.example.com',
    });
  });

  test('skips internal hops when trustedHops is set', () => {
    expect(resolveConnectingHop(receivedHeaders, 1)).toEqual({
      ip: '203.0.113.9',
      helo: 'sender.attacker.example',
    });
  });

  test('defaults trustedHops to 0 when omitted', () => {
    expect(resolveConnectingHop(receivedHeaders)).toEqual(
      resolveConnectingHop(receivedHeaders, 0)
    );
  });

  test('returns null when trustedHops exceeds the number of Received headers', () => {
    expect(resolveConnectingHop(receivedHeaders, 5)).toBeNull();
  });

  test('returns null when there are no Received headers at all', () => {
    expect(resolveConnectingHop([], 0)).toBeNull();
  });

  test('returns null when passed null/undefined', () => {
    expect(resolveConnectingHop(undefined, 0)).toBeNull();
  });
});

describe('parseRspamdOutput', () => {
  test('should parse score and required from a response, ignoring action and non-auth symbols', () => {
    const response = {
      action: 'reject',
      score: 15.0,
      required_score: 10.0,
      symbols: {
        WHITELIST_EMAIL: { score: -20 },
      },
    };

    const result = parseRspamdOutput(response);
    expect(result).toEqual({
      score: 15.0,
      required: 10.0,
      senderAuthenticated: false,
    });
  });

  test('should handle missing fields with defaults', () => {
    const response = {};

    const result = parseRspamdOutput(response);
    expect(result).toEqual({
      score: 0,
      required: 0,
      senderAuthenticated: false,
    });
  });

  test('should mark authenticated when R_DKIM_ALLOW is present', () => {
    const response = {
      score: 1.0,
      required_score: 10.0,
      symbols: { R_DKIM_ALLOW: { score: -0.2 } },
    };

    expect(parseRspamdOutput(response).senderAuthenticated).toBe(true);
  });

  test('should mark authenticated when DMARC_POLICY_ALLOW is present', () => {
    const response = {
      score: 1.0,
      required_score: 10.0,
      symbols: { DMARC_POLICY_ALLOW: { score: -0.5 } },
    };

    expect(parseRspamdOutput(response).senderAuthenticated).toBe(true);
  });

  test('should mark authenticated when both DKIM and DMARC symbols are present', () => {
    const response = {
      score: 1.0,
      required_score: 10.0,
      symbols: {
        R_DKIM_ALLOW: { score: -0.2 },
        DMARC_POLICY_ALLOW: { score: -0.5 },
      },
    };

    expect(parseRspamdOutput(response).senderAuthenticated).toBe(true);
  });

  test('should NOT mark authenticated for DMARC_POLICY_ALLOW_WITH_FAILURES alone', () => {
    const response = {
      score: 1.0,
      required_score: 10.0,
      symbols: { DMARC_POLICY_ALLOW_WITH_FAILURES: { score: -0.5 } },
    };

    expect(parseRspamdOutput(response).senderAuthenticated).toBe(false);
  });

  test('should not mark authenticated when neither DKIM nor DMARC symbols are present', () => {
    const response = {
      score: 1.0,
      required_score: 10.0,
      symbols: { R_SPF_ALLOW: { score: -0.2 } },
    };

    expect(parseRspamdOutput(response).senderAuthenticated).toBe(false);
  });

  test('should throw error for non-object response', () => {
    expect(() => parseRspamdOutput('invalid')).toThrow(
      'Invalid Rspamd response format'
    );
  });

  test('should mark the thrown error as permanent for an invalid response shape', () => {
    try {
      parseRspamdOutput('invalid');
      expect.unreachable('parseRspamdOutput should have thrown');
    } catch (err) {
      expect((err as { permanent?: boolean }).permanent).toBe(true);
    }
  });

  test('should throw error for null response', () => {
    expect(() => parseRspamdOutput(null)).toThrow(
      'Invalid Rspamd response format'
    );
  });
});

describe('parseAiClassificationOutput', () => {
  test('should parse a valid JSON response', () => {
    const result = parseAiClassificationOutput(
      '{"score": 42, "reasoning": "Looks borderline"}'
    );
    expect(result).toEqual({ score: 42, reasoning: 'Looks borderline' });
  });

  test('should parse a response fenced with ```json', () => {
    const content = '```json\n{"score": 85, "reasoning": "Phishing link"}\n```';
    expect(parseAiClassificationOutput(content)).toEqual({
      score: 85,
      reasoning: 'Phishing link',
    });
  });

  test('should parse a response fenced with plain ``` (no json tag)', () => {
    const content = '```\n{"score": 10, "reasoning": "Clean"}\n```';
    expect(parseAiClassificationOutput(content)).toEqual({
      score: 10,
      reasoning: 'Clean',
    });
  });

  test('should clamp a score above 100', () => {
    const result = parseAiClassificationOutput(
      '{"score": 150, "reasoning": "Very spammy"}'
    );
    expect(result.score).toBe(100);
  });

  test('should clamp a score below 0', () => {
    const result = parseAiClassificationOutput(
      '{"score": -20, "reasoning": "Negative"}'
    );
    expect(result.score).toBe(0);
  });

  test('should throw when score is missing', () => {
    expect(() =>
      parseAiClassificationOutput('{"reasoning": "No score here"}')
    ).toThrow(/missing numeric "score"/);
  });

  test('should throw when score is not a number', () => {
    expect(() =>
      parseAiClassificationOutput('{"score": "high", "reasoning": "bad type"}')
    ).toThrow(/missing numeric "score"/);
  });

  test('should default reasoning to an empty string when missing', () => {
    const result = parseAiClassificationOutput('{"score": 30}');
    expect(result).toEqual({ score: 30, reasoning: '' });
  });

  test('should throw on non-JSON garbage input', () => {
    expect(() => parseAiClassificationOutput('not json at all')).toThrow(
      /not valid JSON/
    );
  });

  test('should throw on empty content', () => {
    expect(() => parseAiClassificationOutput('')).toThrow(
      'AI response content is empty'
    );
  });

  test('should throw on null content', () => {
    expect(() => parseAiClassificationOutput(null)).toThrow(
      'AI response content is empty'
    );
  });
});
