import { extractHeaders, extractSenders } from '../src/lib/utils/email.js';

// We'll skip mocking pino for now and focus on testing the core functions
// The tests should still work without mocking the logger

describe('extractHeaders', () => {
  test('should extract headers from raw email', () => {
    const rawEmail = `From: test@example.com
To: recipient@example.com
Subject: Test Email
Date: Mon, 15 May 2023 10:30:00 +0000
Content-Type: text/plain

This is a test email.`;

    const headers = extractHeaders(rawEmail);

    expect(headers).toEqual({
      'from': 'test@example.com',
      'to': 'recipient@example.com',
      'subject': 'Test Email',
      'date': 'Mon, 15 May 2023 10:30:00 +0000',
      'content-type': 'text/plain'
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

    const headers = extractHeaders(rawEmail);

    expect(headers['x-custom-header']).toBe('This is a long header that spans multiple lines with indentation');
  });

  test('should return empty object for invalid input', () => {
    const rawEmail = 'This is not a valid email';
    const headers = extractHeaders(rawEmail);

    expect(headers).toEqual({});
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
