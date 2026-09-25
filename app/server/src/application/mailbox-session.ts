import type { ImapFlow } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';
import type { Mailbox } from '../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../infrastructure/imap/folder.resolver.js';
import type { MailboxSettings } from '../config/mailbox-settings.defaults.js';

/**
 * The per-mailbox data every use-case and step needs, replacing terminal's
 * `ctx` for anything that operates on a specific mailbox (see design.md D4).
 * Singletons (config sections, gateways, repositories, the shared
 * `AiFailureTracker`) come from Nest DI instead; a `MailboxSession` carries
 * only what varies per mailbox, and is built fresh for each job (D9).
 */
export interface MailboxSession {
  /** The mailbox record this session operates on. */
  readonly mailbox: Mailbox;
  /** The open, connected IMAP connection for this session. */
  readonly imap: ImapFlow;
  /**
   * This mailbox's behavioral settings. Always `defaultMailboxSettings` for
   * now - there is no per-mailbox override storage yet - but typed as
   * `MailboxSettings` rather than a literal reference to the default, since
   * `4-mailbox-settings-email` will resolve stored overrides into this same
   * shape without changing `MailboxSession`.
   */
  readonly settings: MailboxSettings;
  /** This mailbox's folders, resolved against the IMAP server's delimiter. */
  readonly folders: MailboxFolders;
  /**
   * A logger scoped to this mailbox - every line it emits carries
   * `{ mailboxId: mailbox.id }`. This is what replaces terminal's ambient
   * `rootLogger.forComponent(...)` pattern for anything operating on a
   * specific mailbox: instead of a global logger scoped per call site, each
   * session carries its own logger, already bound.
   */
  readonly logger: PinoLogger;
}

/**
 * The already-resolved pieces `createMailboxSession` assembles into a
 * `MailboxSession`. `logger` is the base logger to scope - typically the
 * app's root pino logger, obtained via DI (e.g. nestjs-pino's `PinoLogger`,
 * whose `.logger` getter returns a plain `pino.Logger`) - not yet bound to
 * this mailbox.
 */
export interface MailboxSessionParts {
  readonly mailbox: Mailbox;
  readonly imap: ImapFlow;
  readonly settings: MailboxSettings;
  readonly folders: MailboxFolders;
  readonly logger: PinoLogger;
}

/**
 * Assembles a `MailboxSession` from its already-resolved parts, so callers
 * don't hand-construct the object inline everywhere.
 *
 * This does not resolve folders (`resolveMailboxFolders`) or connect the
 * IMAP client (`imap-connection.factory.ts`'s `newClient`/`withSession`) -
 * both are expected to already have happened, and are passed in as `parts`.
 * The one piece of real work it does is scoping the logger: it binds
 * `parts.logger` to `{ mailboxId: mailbox.id }` via `.child()`, once, so
 * every step and gateway call downstream that logs through
 * `session.logger` is automatically attributed to this mailbox.
 *
 * @throws If `mailbox.id` is empty, or `imap` is not a usable (connected)
 *   connection - both would silently produce a broken session otherwise.
 */
export function createMailboxSession(parts: MailboxSessionParts): MailboxSession {
  const { mailbox, imap, settings, folders, logger } = parts;

  if (!mailbox.id) {
    throw new Error('Cannot create a MailboxSession for a mailbox with no id');
  }
  if (!imap.usable) {
    throw new Error(
      `Cannot create a MailboxSession for mailbox "${mailbox.id}": IMAP connection is not usable (not connected)`
    );
  }

  return {
    mailbox,
    imap,
    settings,
    folders,
    logger: logger.child({ mailboxId: mailbox.id }),
  };
}
