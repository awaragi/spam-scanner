import { vi } from 'vitest';

/**
 * Shape of the no-op logger `createNoOpLogger`/`createNoOpRootLogger` build -
 * matches logger shape closely enough for test doubles (all methods are
 * `vi.fn()` spies, so assertions like `expect(logger.warn).toHaveBeenCalled()`
 * work directly).
 */
export interface NoOpLogger {
  trace: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  fatal: ReturnType<typeof vi.fn>;
  forComponent: () => NoOpLogger;
  forMessage: () => NoOpLogger;
}

/**
 * Builds a no-op logger for `vi.mock('.../logger.ts', ...)` factories.
 * Pass `overrides` to substitute a specific hoisted spy (e.g. `{ warn }`)
 * when a test needs to assert on that method's calls across the mock's
 * lifetime.
 */
export function createNoOpLogger(
  overrides: Partial<NoOpLogger> = {}
): NoOpLogger {
  const logger: NoOpLogger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    forComponent: () => logger,
    forMessage: () => logger,
    ...overrides,
  };
  return logger;
}

/**
 * Builds a `{ forComponent: () => NoOpLogger }` root logger, the shape
 * `logger` is mocked as everywhere in this codebase's tests.
 */
export function createNoOpRootLogger(
  overrides: Partial<NoOpLogger> = {}
): {
  forComponent: () => NoOpLogger;
} {
  return { forComponent: () => createNoOpLogger(overrides) };
}
