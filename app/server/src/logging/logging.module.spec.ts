import { describe, test, expect } from 'vitest';
import { Writable } from 'stream';
import pino from 'pino';
import { buildPinoOptions, canLoadPinoPretty } from './logging.module.js';
import type { LoggingConfig } from '../config/app-config.js';

function fixtureLoggingConfig(overrides: Partial<LoggingConfig> = {}): LoggingConfig {
  return {
    level: 'info',
    format: 'json',
    filterIncludes: '',
    filterExcludes: '',
    ...overrides,
  } as LoggingConfig;
}

function captureLines(): { stream: Writable; lines: () => unknown[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line)),
  };
}

describe('buildPinoOptions', () => {
  test('defaults to info level and json format', () => {
    const options = buildPinoOptions(fixtureLoggingConfig());
    expect(options.level).toBe('info');
    expect(options.transport).toBeUndefined();
  });

  test('accepts a valid level case-insensitively', () => {
    const options = buildPinoOptions(fixtureLoggingConfig({ level: 'DEBUG' }));
    expect(options.level).toBe('debug');
  });

  test('falls back to info for an invalid level rather than rejecting it', () => {
    const options = buildPinoOptions(fixtureLoggingConfig({ level: 'verbose' }));
    expect(options.level).toBe('info');
  });

  test('falls back to json for an invalid format rather than rejecting it', () => {
    const options = buildPinoOptions(fixtureLoggingConfig({ format: 'xml' }));
    expect(options.transport).toBeUndefined();
  });

  test('redacts IMAP_PASSWORD, RSPAMD_PASSWORD and AI_API_KEY at the top level', () => {
    const options = buildPinoOptions(fixtureLoggingConfig({ level: 'debug' }));
    const { stream, lines } = captureLines();
    const logger = pino(options, stream);

    logger.debug(
      {
        IMAP_PASSWORD: 'super-secret-imap',
        RSPAMD_PASSWORD: 'super-secret-rspamd',
        AI_API_KEY: 'super-secret-ai',
        SAFE_FIELD: 'not-a-secret',
      },
      'test log with secrets'
    );

    const [line] = lines();
    const text = JSON.stringify(line);
    expect(text).not.toContain('super-secret-imap');
    expect(text).not.toContain('super-secret-rspamd');
    expect(text).not.toContain('super-secret-ai');
    expect(text).toContain('not-a-secret');
    expect(text).toContain('[REDACTED]');
  });

  test('redacts the same secrets one level of nesting deep (e.g. under headers)', () => {
    const options = buildPinoOptions(fixtureLoggingConfig({ level: 'debug' }));
    const { stream, lines } = captureLines();
    const logger = pino(options, stream);

    logger.debug(
      {
        headers: {
          IMAP_PASSWORD: 'nested-secret-imap',
          RSPAMD_PASSWORD: 'nested-secret-rspamd',
          AI_API_KEY: 'nested-secret-ai',
          Password: 'nested-generic-password',
        },
      },
      'nested secrets'
    );

    const [line] = lines();
    const text = JSON.stringify(line);
    expect(text).not.toContain('nested-secret-imap');
    expect(text).not.toContain('nested-secret-rspamd');
    expect(text).not.toContain('nested-secret-ai');
    expect(text).not.toContain('nested-generic-password');
  });

  describe('component filtering', () => {
    test('logs every component when no filter is set', () => {
      const options = buildPinoOptions(fixtureLoggingConfig());
      const { stream, lines } = captureLines();
      const logger = pino(options, stream);

      logger.child({ component: 'imap' }).info('imap log');
      logger.child({ component: 'rspamd' }).info('rspamd log');

      expect(lines()).toHaveLength(2);
    });

    test('LOG_FILTER_INCLUDES only logs the listed components', () => {
      const options = buildPinoOptions(
        fixtureLoggingConfig({ filterIncludes: 'imap,rspamd' })
      );
      const { stream, lines } = captureLines();
      const logger = pino(options, stream);

      logger.child({ component: 'imap' }).info('kept');
      logger.child({ component: 'ai' }).info('dropped');

      const entries = lines();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ msg: 'kept' });
    });

    test('LOG_FILTER_EXCLUDES drops the listed components', () => {
      const options = buildPinoOptions(
        fixtureLoggingConfig({ filterExcludes: 'imapflow' })
      );
      const { stream, lines } = captureLines();
      const logger = pino(options, stream);

      logger.child({ component: 'imapflow' }).info('dropped');
      logger.child({ component: 'scanner' }).info('kept');

      const entries = lines();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ msg: 'kept' });
    });

    test('a log line with no component binding is never filtered out', () => {
      const options = buildPinoOptions(
        fixtureLoggingConfig({ filterIncludes: 'imap' })
      );
      const { stream, lines } = captureLines();
      const logger = pino(options, stream);

      logger.info('no component here');

      expect(lines()).toHaveLength(1);
    });
  });
});

describe('canLoadPinoPretty', () => {
  test('returns true when the resolver succeeds', () => {
    expect(
      canLoadPinoPretty(() => 'file:///node_modules/pino-pretty/index.js')
    ).toBe(true);
  });

  test('returns false when the resolver throws (e.g. module not installed)', () => {
    expect(
      canLoadPinoPretty(() => {
        throw new Error('Cannot find package "pino-pretty"');
      })
    ).toBe(false);
  });
});
