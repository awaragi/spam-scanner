import { ImapFlow } from 'imapflow';
import type { Logger as ImapFlowLogger } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';

/**
 * IMAP connection configuration fields from `MailboxConnectionConfig`.
 * Used as the parameter to `newClient()` and `withSession()`.
 */
export interface ImapConnectionConfig {
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapPassword: string;
  imapTls: boolean;
  imapAllowInsecure: boolean;
}

/**
 * Extra `ImapFlow` constructor options a caller may need beyond the
 * connection fields every client shares - currently just `disableAutoIdle`,
 * needed by `MailboxRunner`'s dedicated IDLE connection (design.md D6's
 * Context section) so `imapflow` never enters IDLE - or falls back to
 * `missingIdleCommand`'s polling - on its own initiative behind the caller's
 * back.
 */
export interface NewClientOptions {
  disableAutoIdle?: boolean;
}

/**
 * Creates and returns a configured ImapFlow instance.
 *
 * Preserves the TLS/STARTTLS logic from terminal's `imap-transport-security`
 * capability: when `imapTls` is false (insecure mode), `doSTARTTLS` is set to
 * true, enforcing STARTTLS before authentication and preventing silent plaintext
 * fallback. When `imapTls` is true, STARTTLS is left unset (library default),
 * since direct TLS already provides encryption.
 *
 * @param connection - The mailbox's IMAP connection info.
 * @param logger - Optional pino logger. If not provided, no logging occurs.
 * @param options - Extra `ImapFlow` options (see `NewClientOptions`).
 * @returns A configured ImapFlow instance, not yet connected.
 */
export function newClient(
  connection: ImapConnectionConfig,
  logger?: PinoLogger,
  options?: NewClientOptions
): ImapFlow {
  // Create a pino logger for ImapFlow that redirects to the optional logger.
  // If no logger is provided, create no-op functions to avoid null checks.
  const logDebug = logger?.debug.bind(logger) ?? (() => {});
  const logInfo = logger?.debug.bind(logger) ?? (() => {}); // Redirect info to debug
  const logWarn = logger?.warn.bind(logger) ?? (() => {});
  const logError = logger?.error.bind(logger) ?? (() => {});
  const logFatal = logger?.fatal.bind(logger) ?? (() => {});
  const logTrace = logger?.trace.bind(logger) ?? (() => {});

  return new ImapFlow({
    host: connection.imapHost,
    port: connection.imapPort,
    secure: connection.imapTls === true,
    // Only set doSTARTTLS when secure=false. When secure=true, STARTTLS
    // is left unset (library default), since direct TLS already provides
    // encryption. See `imap-transport-security` capability.
    doSTARTTLS: connection.imapTls ? undefined : true,
    auth: {
      user: connection.imapUser,
      pass: connection.imapPassword,
    },
    logger: {
      debug: logDebug,
      info: logInfo,
      warn: logWarn,
      error: logError,
      fatal: logFatal,
      trace: logTrace,
    } as ImapFlowLogger,
    emitLogs: false,
    maxIdleTime: 29 * 60 * 1000,
    disableAutoIdle: options?.disableAutoIdle,
  });
}

/**
 * Safely logs out an ImapFlow client, swallowing any errors.
 *
 * Safe to call in a `finally` block even when `connect()` never succeeded
 * (there's nothing to log out of, and errors are suppressed so they don't
 * mask the original error the caller already handled).
 *
 * @param imap - The ImapFlow instance to log out.
 * @param logger - Optional pino logger for debug logging of the failure.
 */
export async function safeLogout(
  imap: ImapFlow,
  logger?: PinoLogger
): Promise<void> {
  try {
    await imap.logout();
  } catch (err) {
    if (logger) {
      logger.debug(
        { error: err instanceof Error ? err.message : String(err) },
        'Logout failed (connection likely never established)'
      );
    }
  }
}

/**
 * Centralizes the connect → run → always logout pattern.
 *
 * Creates an ImapFlow instance, connects it, runs the callback, and ensures
 * safe logout happens in a finally block, even if the callback throws.
 *
 * @param connection - The mailbox's IMAP connection info.
 * @param fn - Async callback that receives the connected ImapFlow instance.
 * @param logger - Optional pino logger passed to newClient and safeLogout.
 * @returns The return value of the callback.
 * @throws Re-throws any error from connection, the callback, or logout (logout
 *         errors are swallowed; all others propagate).
 */
export async function withSession<T>(
  connection: ImapConnectionConfig,
  fn: (imap: ImapFlow) => Promise<T>,
  logger?: PinoLogger
): Promise<T> {
  const imap = newClient(connection, logger);
  try {
    await imap.connect();
    return await fn(imap);
  } finally {
    await safeLogout(imap, logger);
  }
}
