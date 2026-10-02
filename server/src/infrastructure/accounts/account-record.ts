/**
 * One mailbox account record, durably stored by `AccountStore` - the
 * `server/mailbox-accounts` spec's "Account records are stored in a
 * versioned JSON file under SPAM_SCANNER_DATA" requirement. `id` is the
 * mailbox owner's email address (immutable - see the `server/mailbox-registry`
 * spec), distinct from `imapUser`, which may be a bare username on some
 * providers. `imapPassword` is stored in plain text (see design.md's
 * "Risks/Trade-offs" - encryption at rest is explicitly deferred).
 */
export interface AccountRecord {
  readonly id: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapUser: string;
  readonly imapPassword: string;
  readonly imapTls: boolean;
  readonly imapAllowInsecure: boolean;
  readonly stateFolder: string;
  readonly enabled: boolean;
  /** Admin-only per-mailbox AI opt-out - see `server/mailbox-settings`. */
  readonly aiEnabled: boolean;
}
