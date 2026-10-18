import type { Logger as PinoLogger } from 'pino';
import type { ImapConnectionConfig } from '../imap/imap-connection.factory.js';
import { newClient, safeLogout } from '../imap/imap-connection.factory.js';

/**
 * Verifies IMAP connectivity for `connection` before an account mutation is
 * persisted - the `server/mailbox-accounts` spec's "IMAP connectivity is
 * verified before every account persistence except delete" requirement.
 * Reuses `imap-connection.factory`'s `newClient` (same TLS/`allowInsecure`
 * rules as every production connection) and always logs out in `finally`,
 * even on a failed `connect()`. A connection failure propagates to the
 * caller (`AccountAdminService`) rather than being swallowed here - the
 * caller decides how to translate it into an HTTP response.
 */
export async function testImapConnection(
  connection: ImapConnectionConfig,
  logger?: PinoLogger,
): Promise<void> {
  const imap = newClient(connection, logger);
  try {
    await imap.connect();
  } finally {
    await safeLogout(imap, logger);
  }
}
