import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ImapFlow } from 'imapflow';

const { mockGetImapDelimiter } = vi.hoisted(() => ({
  mockGetImapDelimiter: vi.fn(),
}));

vi.mock('./mailbox.gateway.js', () => ({
  getImapDelimiter: mockGetImapDelimiter,
}));

import { resolveMailboxFolders } from './folder.resolver.js';
import type { MailboxFolders } from './folder.resolver.js';

const fakeImap = {} as ImapFlow;

function fixtureFolders(): MailboxFolders {
  return {
    inbox: 'INBOX',
    spam: 'INBOX.spam',
    spamLow: 'INBOX.spam.low',
    spamHigh: 'INBOX.spam.high',
    trainSpam: 'INBOX.scanner.train.spam',
    trainHam: 'INBOX.scanner.train.ham',
    trainWhitelist: 'INBOX.scanner.train.whitelist',
    trainBlacklist: 'INBOX.scanner.train.blacklist',
    state: 'scanner.state',
  };
}

describe('resolveMailboxFolders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('dot-delimited server: dot-joined folders are returned unchanged', async () => {
    mockGetImapDelimiter.mockResolvedValue('.');

    const resolved = await resolveMailboxFolders(fakeImap, fixtureFolders());

    expect(resolved.trainSpam).toBe('INBOX.scanner.train.spam');
    expect(resolved.inbox).toBe('INBOX');
    expect(resolved.state).toBe('scanner.state');
  });

  test('slash-delimited server: dot-joined folders are resolved to slashes', async () => {
    mockGetImapDelimiter.mockResolvedValue('/');

    const resolved = await resolveMailboxFolders(fakeImap, fixtureFolders());

    expect(resolved.trainSpam).toBe('INBOX/scanner/train/spam');
    expect(resolved.spamLow).toBe('INBOX/spam/low');
  });

  test('no delimiter discoverable: resolveMailboxFolders throws', async () => {
    mockGetImapDelimiter.mockResolvedValue(null);

    await expect(
      resolveMailboxFolders(fakeImap, fixtureFolders())
    ).rejects.toThrow(/could not determine IMAP server delimiter/);
  });

  test('calling resolveMailboxFolders twice on its own result is idempotent (splitFolderParts treats . / \\ uniformly)', async () => {
    mockGetImapDelimiter.mockResolvedValue('/');

    const first = await resolveMailboxFolders(fakeImap, fixtureFolders());
    const second = await resolveMailboxFolders(fakeImap, first);

    expect(first.trainSpam).toBe('INBOX/scanner/train/spam');
    expect(second.trainSpam).toBe('INBOX/scanner/train/spam');
  });

  test('does not mutate the input folders object', async () => {
    mockGetImapDelimiter.mockResolvedValue('/');
    const input = fixtureFolders();
    const inputSnapshot = { ...input };

    await resolveMailboxFolders(fakeImap, input);

    expect(input).toEqual(inputSnapshot);
  });

  test('two mailboxes with different delimiters and different folder settings resolve independently, with no shared state', async () => {
    // Terminal's resolveFolders mutated a single shared `config` object in
    // place, so two mailboxes could never be resolved safely in the same
    // process - a second call would clobber the first mailbox's paths.
    // resolveMailboxFolders returns a fresh object per call, so both results
    // remain correct and independent no matter the call order.
    mockGetImapDelimiter.mockResolvedValueOnce('.');
    const mailboxAFolders: MailboxFolders = {
      inbox: 'INBOX',
      spam: 'INBOX.spam',
      spamLow: 'INBOX.spam.low',
      spamHigh: 'INBOX.spam.high',
      trainSpam: 'INBOX.scanner.train.spam',
      trainHam: 'INBOX.scanner.train.ham',
      trainWhitelist: 'INBOX.scanner.train.whitelist',
      trainBlacklist: 'INBOX.scanner.train.blacklist',
      state: 'scanner.state',
    };

    mockGetImapDelimiter.mockResolvedValueOnce('/');
    const mailboxBFolders: MailboxFolders = {
      inbox: 'Inbox',
      spam: 'Inbox.Junk',
      spamLow: 'Inbox.Junk.Low',
      spamHigh: 'Inbox.Junk.High',
      trainSpam: 'Inbox.Train.Spam',
      trainHam: 'Inbox.Train.Ham',
      trainWhitelist: 'Inbox.Train.Whitelist',
      trainBlacklist: 'Inbox.Train.Blacklist',
      state: 'Inbox.State',
    };

    const [resolvedA, resolvedB] = await Promise.all([
      resolveMailboxFolders(fakeImap, mailboxAFolders),
      resolveMailboxFolders(fakeImap, mailboxBFolders),
    ]);

    expect(resolvedA).toEqual({
      inbox: 'INBOX',
      spam: 'INBOX.spam',
      spamLow: 'INBOX.spam.low',
      spamHigh: 'INBOX.spam.high',
      trainSpam: 'INBOX.scanner.train.spam',
      trainHam: 'INBOX.scanner.train.ham',
      trainWhitelist: 'INBOX.scanner.train.whitelist',
      trainBlacklist: 'INBOX.scanner.train.blacklist',
      state: 'scanner.state',
    });
    expect(resolvedB).toEqual({
      inbox: 'Inbox',
      spam: 'Inbox/Junk',
      spamLow: 'Inbox/Junk/Low',
      spamHigh: 'Inbox/Junk/High',
      trainSpam: 'Inbox/Train/Spam',
      trainHam: 'Inbox/Train/Ham',
      trainWhitelist: 'Inbox/Train/Whitelist',
      trainBlacklist: 'Inbox/Train/Blacklist',
      state: 'Inbox/State',
    });
    // Neither mailbox's original settings object was touched by the other's
    // resolution.
    expect(mailboxAFolders.trainSpam).toBe('INBOX.scanner.train.spam');
    expect(mailboxBFolders.trainSpam).toBe('Inbox.Train.Spam');
  });
});
