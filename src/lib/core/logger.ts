import pino from 'pino';

/**
 * Minimal logger shape actually used across the app - `trace`/`debug`/
 * `info`/`warn`/`error`/`fatal` plus the two component/message scoping
 * methods this module attaches. Deliberately not the full `pino.Logger`
 * interface: `createNoOpLogger()` below returns a plain object satisfying
 * only this shape, not a real Pino instance.
 */
export interface Logger {
  trace: pino.LogFn;
  debug: pino.LogFn;
  info: pino.LogFn;
  warn: pino.LogFn;
  error: pino.LogFn;
  fatal: pino.LogFn;
  child: (bindings: pino.Bindings) => Logger;
}

export interface ComponentLogger extends Logger {
  forMessage: (uid?: number | null) => Logger;
}

export interface RootLogger extends Logger {
  forComponent: (component: string) => ComponentLogger;
}

// Read environment variables
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FORMAT = process.env.LOG_FORMAT || 'json';
const LOG_FILTER_INCLUDES = process.env.LOG_FILTER_INCLUDES || '';
const LOG_FILTER_EXCLUDES = process.env.LOG_FILTER_EXCLUDES || '';

// Validate log level
const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const logLevel = VALID_LOG_LEVELS.includes(LOG_LEVEL.toLowerCase())
  ? LOG_LEVEL.toLowerCase()
  : 'info';

if (LOG_LEVEL && !VALID_LOG_LEVELS.includes(LOG_LEVEL.toLowerCase())) {
  console.warn(`Invalid LOG_LEVEL "${LOG_LEVEL}", defaulting to "info"`);
}

// Validate log format
const VALID_LOG_FORMATS = ['json', 'jsonl', 'pretty'];
const logFormat = VALID_LOG_FORMATS.includes(LOG_FORMAT.toLowerCase())
  ? LOG_FORMAT.toLowerCase()
  : 'json';

if (LOG_FORMAT && !VALID_LOG_FORMATS.includes(LOG_FORMAT.toLowerCase())) {
  console.warn(`Invalid LOG_FORMAT "${LOG_FORMAT}", defaulting to "json"`);
}

// Parse component filters
const filterIncludesComponents = LOG_FILTER_INCLUDES
  ? LOG_FILTER_INCLUDES.split(',')
      .map(c => c.trim())
      .filter(c => c.length > 0)
  : [];
const filterExcludesComponents = LOG_FILTER_EXCLUDES
  ? LOG_FILTER_EXCLUDES.split(',')
      .map(c => c.trim())
      .filter(c => c.length > 0)
  : [];

/**
 * Check if a component should be logged based on filters
 * @param {string} component - Component name to check
 * @returns {boolean} - True if component should be logged
 */
function shouldLogComponent(component: string): boolean {
  // If includes filter is set, component must be in the list
  if (filterIncludesComponents.length > 0) {
    if (!filterIncludesComponents.includes(component)) {
      return false;
    }
  }

  // If excludes filter is set, component must not be in the list
  if (filterExcludesComponents.length > 0) {
    if (filterExcludesComponents.includes(component)) {
      return false;
    }
  }

  return true;
}

// Configure Pino options
const options: pino.LoggerOptions = {
  level: logLevel,
  base: null, // Remove default pid and hostname fields
  formatters: {
    level: (label: string) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  // Secrets must never reach logs, even at LOG_LEVEL=debug (which is exactly
  // the level users are told to use when troubleshooting and pasting logs
  // into issues/chats). Paths are relative to each log call's merging
  // object, so this covers both `logger.debug(config, ...)` (secrets at the
  // top level) and any nested `{ headers: { Password } }`-shaped object.
  redact: {
    paths: [
      'IMAP_PASSWORD',
      'RSPAMD_PASSWORD',
      'AI_API_KEY',
      '*.IMAP_PASSWORD',
      '*.RSPAMD_PASSWORD',
      '*.AI_API_KEY',
      '*.headers.Password',
      '*.Password',
    ],
    censor: '[REDACTED]',
  },
};

/**
 * Whether `pino-pretty` can be resolved from this module - it's a
 * devDependency, so it's absent in the production Docker image
 * (`npm ci --omit=dev`). `resolveFn` is injectable so this is unit-testable
 * without needing to actually uninstall the package.
 * @param {(specifier: string) => string} resolveFn
 * @returns {boolean}
 */
export function canLoadPinoPretty(
  resolveFn: (specifier: string) => string = specifier =>
    import.meta.resolve(specifier)
): boolean {
  try {
    resolveFn('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

// Add pino-pretty transport if pretty format requested and available. Pino
// resolves `transport.target` lazily inside `pino(options)` below - a
// try/catch around building this options object can't catch a missing
// module, so availability has to be checked explicitly first.
if (logFormat === 'pretty') {
  if (canLoadPinoPretty()) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    };
  } else {
    console.warn(
      'LOG_FORMAT=pretty requested but pino-pretty is not installed (expected in the production Docker image, which only installs dependencies) - falling back to JSON'
    );
  }
}

// Create root logger instance
const pinoLogger = pino(options);

interface NoOpLogger extends Logger, ComponentLogger, RootLogger {}

/**
 * Creates a no-op logger that doesn't log anything
 * @returns {Object} - Logger with all methods as no-ops
 */
function createNoOpLogger(): NoOpLogger {
  const noOp = ((..._args: unknown[]) => {}) as pino.LogFn;
  const noOpLogger: NoOpLogger = {
    trace: noOp,
    debug: noOp,
    info: noOp,
    warn: noOp,
    error: noOp,
    fatal: noOp,
    child: () => noOpLogger,
    forComponent: () => noOpLogger,
    forMessage: () => noOpLogger,
  };
  return noOpLogger;
}

/**
 * Adds forComponent method to a logger instance
 * @param {Object} logger - Pino logger instance
 * @returns {Object} - Logger with forComponent method
 */
function attachForComponent(logger: pino.Logger): RootLogger {
  const rootWithComponent = logger as unknown as RootLogger;

  /**
   * Creates a component-scoped child logger
   * @param {string} component - Component name (e.g., 'rspamd', 'imap', 'config')
   * @returns {Object} - Child logger with component context and forMessage method
   */
  rootWithComponent.forComponent = function (
    this: pino.Logger,
    component: string
  ): ComponentLogger {
    // Check if this component should be logged
    if (!shouldLogComponent(component)) {
      return createNoOpLogger();
    }

    const componentLogger = this.child({
      component,
    }) as unknown as ComponentLogger;

    /**
     * Creates a message-scoped child logger with UID correlation
     * @param {number} uid - Email UID for correlation
     * @returns {Object} - Child logger with both component and uid context
     */
    componentLogger.forMessage = function (
      this: pino.Logger,
      uid?: number | null
    ): Logger {
      return this.child({ uid });
    };

    return componentLogger;
  };

  return rootWithComponent;
}

// Attach forComponent method to root logger
const rootLogger: RootLogger = attachForComponent(pinoLogger);

// Exported so tests can build a logger against a captured stream, since pino
// writes to its destination fd directly (bypassing process.stdout.write) and
// so can't otherwise observe redaction behavior.
export { rootLogger, options as pinoOptions };
