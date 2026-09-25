import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Logger as PinoLogger, LoggerOptions } from 'pino';
import { stdTimeFunctions } from 'pino';
import { LoggingConfig } from '../config/app-config.js';

const VALID_LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
const VALID_LOG_FORMATS = ['json', 'jsonl', 'pretty'];

/**
 * Whether `pino-pretty` can be resolved from this module - it's a
 * devDependency, so it's absent in the production Docker image
 * (`npm ci --omit=dev`). `resolveFn` is injectable so this is unit-testable
 * without needing to actually uninstall the package. Ported from
 * `terminal/src/lib/core/logger.ts`.
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

/**
 * Component allow/deny gate, matching `terminal/src/lib/core/logger.ts`'s
 * `shouldLogComponent`: an unset `component` binding always logs (this
 * governs `LOG_FILTER_INCLUDES`/`LOG_FILTER_EXCLUDES` for component-scoped
 * child loggers only, not every log line in the process).
 */
function shouldLogComponent(
  component: unknown,
  includes: string[],
  excludes: string[]
): boolean {
  if (typeof component !== 'string') {
    return true;
  }
  if (includes.length > 0 && !includes.includes(component)) {
    return false;
  }
  if (excludes.length > 0 && excludes.includes(component)) {
    return false;
  }
  return true;
}

/**
 * Builds the pino options `logging.module.ts` hands to `nestjs-pino`,
 * preserving terminal's exact level/format/component-filter/redaction
 * behavior (the `logging-levels` capability) - see
 * `terminal/src/lib/core/logger.ts`, which this is ported from.
 *
 * Level and format stay tolerant of a bad value (case-insensitive match,
 * falling back to "info"/"json" with a `console.warn` - the logger itself
 * isn't ready yet to log its own misconfiguration) rather than failing
 * `AppConfigSchema` validation - see `app-config.schema.ts`'s
 * `loggingGroup` comment.
 */
export function buildPinoOptions(logging: LoggingConfig): LoggerOptions {
  const rawLevel = logging.level;
  const level = VALID_LOG_LEVELS.includes(rawLevel.toLowerCase())
    ? rawLevel.toLowerCase()
    : 'info';
  if (rawLevel && !VALID_LOG_LEVELS.includes(rawLevel.toLowerCase())) {
    console.warn(`Invalid LOG_LEVEL "${rawLevel}", defaulting to "info"`);
  }

  const rawFormat = logging.format;
  const format = VALID_LOG_FORMATS.includes(rawFormat.toLowerCase())
    ? rawFormat.toLowerCase()
    : 'json';
  if (rawFormat && !VALID_LOG_FORMATS.includes(rawFormat.toLowerCase())) {
    console.warn(`Invalid LOG_FORMAT "${rawFormat}", defaulting to "json"`);
  }

  const filterIncludesComponents = logging.filterIncludes
    ? logging.filterIncludes
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0)
    : [];
  const filterExcludesComponents = logging.filterExcludes
    ? logging.filterExcludes
        .split(',')
        .map(c => c.trim())
        .filter(c => c.length > 0)
    : [];

  const options: LoggerOptions = {
    level,
    base: null, // Remove default pid and hostname fields
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    timestamp: stdTimeFunctions.isoTime,
    // Secrets must never reach logs, even at LOG_LEVEL=debug (which is
    // exactly the level users are told to use when troubleshooting and
    // pasting logs into issues/chats). Paths are relative to each log call's
    // merging object, so this covers both a top-level secret and any nested
    // `{ headers: { Password } }`-shaped object. Ported unchanged from
    // terminal/src/lib/core/logger.ts.
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
    // nestjs-pino has no `forComponent()`-style creation choke point the way
    // terminal's logger.ts does - this hook runs on every log call across
    // the whole logger tree instead (root, `.child()`, and pino-http's
    // per-request children alike), reading the `component` binding any of
    // them may carry, and drops the call when that component is filtered
    // out - the same semantics as terminal's `shouldLogComponent`.
    hooks: {
      logMethod(this: PinoLogger, inputArgs, method) {
        if (
          !shouldLogComponent(
            this.bindings().component,
            filterIncludesComponents,
            filterExcludesComponents
          )
        ) {
          return;
        }
        method.apply(this, inputArgs);
      },
    },
  };

  // Add pino-pretty transport if pretty format requested and available. Pino
  // resolves `transport.target` lazily inside `pino(options)` - a try/catch
  // around building this options object can't catch a missing module, so
  // availability has to be checked explicitly first.
  if (format === 'pretty') {
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

  return options;
}

/**
 * `nestjs-pino`, configured asynchronously from `ConfigService` (via the
 * typed `LoggingConfig` section) because config must be ready first -
 * `main.ts` (task 7.2) pairs this with `NestFactory.create(AppModule, {
 * bufferLogs: true })`, so nothing logged before this module resolves is
 * lost.
 *
 * `LoggingConfig` isn't re-imported from `config/config.module.ts` here:
 * `AppConfigModule` is `@Global()` (see its doc comment), so as long as
 * `app.module.ts` imports it once, `LoggingConfig` is already injectable
 * anywhere, including here.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [LoggingConfig],
      useFactory: (logging: LoggingConfig) => ({
        pinoHttp: buildPinoOptions(logging),
      }),
    }),
  ],
})
export class AppLoggingModule {}
