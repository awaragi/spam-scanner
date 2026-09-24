import { describe, test, expect } from 'vitest';
import { extractAiContent } from '../../../src/lib/services/ai-content.service.ts';

function buildMessage({
  raw,
  from,
  to,
  subject,
  date,
}: {
  raw?: string;
  from?: Array<{ name?: string; address?: string }>;
  to?: Array<{ name?: string; address?: string }>;
  subject?: string;
  date?: Date;
}) {
  return {
    uid: 1,
    envelope: {
      from: from ?? [{ name: 'Alice', address: 'alice@example.com' }],
      to: to ?? [{ name: 'Bob', address: 'bob@example.com' }],
      subject: subject ?? 'Test Subject',
      date: date ?? new Date('2024-01-01T00:00:00Z'),
    },
    raw,
  };
}

describe('extractAiContent', () => {
  test('extracts plain-text-only body verbatim', async () => {
    const raw = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: Plain',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Hello world, this is plain text.',
    ].join('\r\n');

    const result = await extractAiContent(buildMessage({ raw }), {
      maxInputTokens: 6000,
    });

    expect(result.text).toBe('Hello world, this is plain text.');
    expect(result.from).toBe('Alice <alice@example.com>');
    expect(result.to).toBe('Bob <bob@example.com>');
    expect(result.subject).toBe('Test Subject');
    expect(result.date).toBe('2024-01-01T00:00:00.000Z');
  });

  test('converts HTML-only body to stripped text', async () => {
    const raw = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: HTML only',
      'Content-Type: text/html; charset=utf-8',
      '',
      '<html><body><p>Hello <b>World</b></p></body></html>',
    ].join('\r\n');

    const result = await extractAiContent(buildMessage({ raw }), {
      maxInputTokens: 6000,
    });

    expect(result.text).toBe('Hello World');
    expect(result.text).not.toContain('<p>');
    expect(result.text).not.toContain('<b>');
  });

  test('prefers the plain-text part over the HTML part in multipart/alternative', async () => {
    const boundary = 'BOUNDARY123';
    const raw = [
      'From: alice@example.com',
      'To: bob@example.com',
      'Subject: Multi',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Plain part content.',
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      '',
      '<p>HTML part content</p>',
      `--${boundary}--`,
      '',
    ].join('\r\n');

    const result = await extractAiContent(buildMessage({ raw }), {
      maxInputTokens: 6000,
    });

    expect(result.text).toBe('Plain part content.');
    expect(result.text).not.toContain('HTML part content');
  });

  test('decodes a quoted-printable body', async () => {
    const raw = [
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'caf=C3=A9 test',
    ].join('\r\n');

    const result = await extractAiContent(buildMessage({ raw }), {
      maxInputTokens: 6000,
    });

    expect(result.text).toBe('café test');
  });

  test('decodes a base64 body', async () => {
    const encoded = Buffer.from('Hello base64 world').toString('base64');
    const raw = [
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      encoded,
    ].join('\r\n');

    const result = await extractAiContent(buildMessage({ raw }), {
      maxInputTokens: 6000,
    });

    expect(result.text).toBe('Hello base64 world');
  });

  test('truncates body text to the configured token budget', async () => {
    const raw = [
      'Content-Type: text/plain; charset=utf-8',
      '',
      'a'.repeat(50000),
    ].join('\r\n');

    const result = await extractAiContent(buildMessage({ raw }), {
      maxInputTokens: 10,
    });

    expect(result.text).toBe(`${'a'.repeat(40)}…[truncated]`);
  });

  test('short text under the budget is returned unchanged', async () => {
    const raw = [
      'Content-Type: text/plain; charset=utf-8',
      '',
      'short text',
    ].join('\r\n');

    const result = await extractAiContent(buildMessage({ raw }), {
      maxInputTokens: 6000,
    });

    expect(result.text).toBe('short text');
  });

  test('rejects when the raw message source is missing/malformed', async () => {
    await expect(
      extractAiContent(buildMessage({ raw: undefined }), {
        maxInputTokens: 6000,
      })
    ).rejects.toThrow();
  });
});
