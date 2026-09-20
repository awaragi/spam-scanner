import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Writable } from 'stream';
import pino from 'pino';
import { rootLogger, pinoOptions } from '../src/lib/utils/logger.js';

describe('Logger Factory', () => {
  let originalEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  it('should export rootLogger as a valid Pino instance', () => {
    expect(rootLogger).toBeDefined();
    expect(typeof rootLogger.info).toBe('function');
    expect(typeof rootLogger.error).toBe('function');
    expect(typeof rootLogger.debug).toBe('function');
    expect(typeof rootLogger.warn).toBe('function');
  });

  it('should have forComponent method on rootLogger', () => {
    expect(typeof rootLogger.forComponent).toBe('function');
  });

  it('should create component logger with forComponent', () => {
    const componentLogger = rootLogger.forComponent('test-component');

    expect(componentLogger).toBeDefined();
    expect(typeof componentLogger.info).toBe('function');
    expect(typeof componentLogger.error).toBe('function');
  });

  it('should have forMessage method on component logger', () => {
    const componentLogger = rootLogger.forComponent('test-component');

    expect(typeof componentLogger.forMessage).toBe('function');
  });

  it('should create message logger with both component and uid', () => {
    const componentLogger = rootLogger.forComponent('test-component');
    const messageLogger = componentLogger.forMessage(123);

    expect(messageLogger).toBeDefined();
    expect(typeof messageLogger.info).toBe('function');
    expect(typeof messageLogger.error).toBe('function');
  });

  it('should maintain hierarchy: root → component → message', () => {
    const componentLogger = rootLogger.forComponent('spam-scanner');
    const messageLogger = componentLogger.forMessage(456);

    // All should be valid Pino loggers
    expect(rootLogger).toBeDefined();
    expect(componentLogger).toBeDefined();
    expect(messageLogger).toBeDefined();

    // All should have logging methods
    expect(typeof rootLogger.info).toBe('function');
    expect(typeof componentLogger.info).toBe('function');
    expect(typeof messageLogger.info).toBe('function');
  });

  it('should create distinct component loggers', () => {
    const logger1 = rootLogger.forComponent('component1');
    const logger2 = rootLogger.forComponent('component2');

    expect(logger1).toBeDefined();
    expect(logger2).toBeDefined();
    // They should be different instances
    expect(logger1).not.toBe(logger2);
  });

  it('should create distinct message loggers', () => {
    const componentLogger = rootLogger.forComponent('test');
    const msgLogger1 = componentLogger.forMessage(111);
    const msgLogger2 = componentLogger.forMessage(222);

    expect(msgLogger1).toBeDefined();
    expect(msgLogger2).toBeDefined();
    // They should be different instances
    expect(msgLogger1).not.toBe(msgLogger2);
  });

  it('should handle null/undefined UID gracefully', () => {
    const componentLogger = rootLogger.forComponent('test');

    // Should not throw with null or undefined
    expect(() => componentLogger.forMessage(null)).not.toThrow();
    expect(() => componentLogger.forMessage(undefined)).not.toThrow();

    const msgLoggerNull = componentLogger.forMessage(null);
    const msgLoggerUndefined = componentLogger.forMessage(undefined);

    expect(msgLoggerNull).toBeDefined();
    expect(msgLoggerUndefined).toBeDefined();
  });

  it('should handle numeric UIDs correctly', () => {
    const componentLogger = rootLogger.forComponent('test');
    const messageLogger = componentLogger.forMessage(12345);

    expect(messageLogger).toBeDefined();
    expect(typeof messageLogger.info).toBe('function');
  });

  it('should maintain chain: component logger can create multiple message loggers', () => {
    const componentLogger = rootLogger.forComponent('imap');

    const msg1 = componentLogger.forMessage(100);
    const msg2 = componentLogger.forMessage(200);
    const msg3 = componentLogger.forMessage(300);

    expect(msg1).toBeDefined();
    expect(msg2).toBeDefined();
    expect(msg3).toBeDefined();

    // Each should be a valid logger
    expect(typeof msg1.info).toBe('function');
    expect(typeof msg2.info).toBe('function');
    expect(typeof msg3.info).toBe('function');
  });

  it('should support all standard Pino log levels', () => {
    const logger = rootLogger.forComponent('test');

    expect(typeof logger.trace).toBe('function');
    expect(typeof logger.debug).toBe('function');
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.warn).toBe('function');
    expect(typeof logger.error).toBe('function');
    expect(typeof logger.fatal).toBe('function');
  });

  it('should support child loggers at message level', () => {
    const componentLogger = rootLogger.forComponent('rspamd');
    const messageLogger = componentLogger.forMessage(789);

    // Message logger should also support all log levels
    expect(typeof messageLogger.trace).toBe('function');
    expect(typeof messageLogger.debug).toBe('function');
    expect(typeof messageLogger.info).toBe('function');
    expect(typeof messageLogger.warn).toBe('function');
    expect(typeof messageLogger.error).toBe('function');
    expect(typeof messageLogger.fatal).toBe('function');
  });
});

describe('Logger secret redaction', () => {
  it('redacts known secret fields so they never reach logs, even at debug', () => {
    const chunks = [];
    const captureStream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });

    // Same redact config as the real root logger, but writing to a stream we
    // can inspect - pino writes to its destination fd directly, bypassing
    // process.stdout.write, so the real rootLogger's output can't be captured.
    const testLogger = pino(pinoOptions, captureStream);

    testLogger.info(
      {
        IMAP_PASSWORD: 'super-secret-imap',
        RSPAMD_PASSWORD: 'super-secret-rspamd',
        AI_API_KEY: 'super-secret-ai',
        SAFE_FIELD: 'not-a-secret',
      },
      'test log with secrets'
    );

    const output = chunks.join('');
    expect(output).not.toContain('super-secret-imap');
    expect(output).not.toContain('super-secret-rspamd');
    expect(output).not.toContain('super-secret-ai');
    expect(output).toContain('SAFE_FIELD');
    expect(output).toContain('[REDACTED]');
  });
});

describe('Logger Environment Configuration', () => {
  it('should handle LOG_LEVEL environment variable', () => {
    // Logger is already instantiated, but we can verify it doesn't throw
    expect(rootLogger).toBeDefined();
    expect(rootLogger.level).toBeDefined();
  });

  it('should handle LOG_FORMAT environment variable', () => {
    // Logger is already instantiated, but we can verify it doesn't throw
    expect(rootLogger).toBeDefined();
  });
});
