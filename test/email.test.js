import { extractSenders } from '../src/lib/utils/email.js';

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
