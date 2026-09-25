/**
 * The shape every other layer uses to refer to a mailbox - scanning,
 * training, folder init, and the rspamd/IMAP gateways - regardless of which
 * registry produced it (today `MailboxRepository`, env-backed; later, real
 * storage). See the `server/mailbox-registry` spec.
 *
 * `id` is the mailbox owner's email address, stored and used separately from
 * the IMAP login (`imapUser`), which may be a bare username on a
 * self-hosted server (`server/mailbox-registry`'s second requirement).
 *
 * There is deliberately no separate "rspamd user" field. rspamd itself has
 * no mailbox awareness (see CLAUDE.md) - the server is what addresses each
 * mailbox's rspamd data (bayes/list state) by an identifier of its own
 * choosing, and that identifier is always `id` (`server/mailbox-registry`'s
 * third requirement: "This SHALL NOT be a separately configurable value").
 * A distinct stored field could always be independently set to diverge from
 * `id`, by a future config path or a bug; omitting it entirely makes that
 * structurally impossible rather than merely conventionally avoided. Callers
 * that need "the rspamd user for this mailbox" use `rspamdUserFor()` below
 * (equivalently, `mailbox.id` directly).
 */
export interface Mailbox {
  /** The mailbox owner's email address - also this mailbox's rspamd user. */
  readonly id: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapUser: string;
  readonly imapPassword: string;
  readonly imapTls: boolean;
  readonly imapAllowInsecure: boolean;
  readonly stateFolder: string;
}

/**
 * The rspamd user for a mailbox - always its `id`, per the
 * `server/mailbox-registry` spec's "A mailbox's rspamd user is always its
 * mailbox id" requirement. This is a pure function of `mailbox.id`, not a
 * stored field, so there is no value anywhere for a config path to
 * independently set: whatever `id` is, the rspamd user is that same value,
 * always.
 */
export function rspamdUserFor(mailbox: Mailbox): string {
  return mailbox.id;
}
