import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.ts';
import { asImapFlow } from '../../../support/imap-fakes.ts';

vi.mock('../../../../src/lib/clients/imap.client.ts', () => ({
  moveMessages: vi.fn().mockResolvedValue(undefined),
}));

import { moveToFolders } from '../../../../src/lib/controllers/steps/folder-move.step.ts';
import { moveMessages } from '../../../../src/lib/clients/imap.client.ts';

const mockedMoveMessages = vi.mocked(moveMessages);
const mockImap = asImapFlow({});

describe('moveToFolders', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('moves low-spam messages to FOLDER_SPAM_LOW and high-spam to FOLDER_SPAM_HIGH', async () => {
    const ctx = fixtureContext({
      config: { FOLDER_SPAM_LOW: 'spam.low', FOLDER_SPAM_HIGH: 'spam.high' },
    });
    const lowSpamMessages = [{ uid: 1 }];
    const highSpamMessages = [{ uid: 2 }];

    await moveToFolders(
      mockImap,
      { nonSpamMessages: [], lowSpamMessages, highSpamMessages },
      ctx
    );

    expect(mockedMoveMessages).toHaveBeenCalledWith(
      mockImap,
      lowSpamMessages,
      'spam.low'
    );
    expect(mockedMoveMessages).toHaveBeenCalledWith(
      mockImap,
      highSpamMessages,
      'spam.high'
    );
  });

  test('throws when FOLDER_SPAM_LOW is not configured', async () => {
    const ctx = fixtureContext({
      config: { FOLDER_SPAM_LOW: '', FOLDER_SPAM_HIGH: 'spam.high' },
    });

    await expect(
      moveToFolders(
        mockImap,
        { nonSpamMessages: [], lowSpamMessages: [], highSpamMessages: [] },
        ctx
      )
    ).rejects.toThrow('FOLDER_SPAM_LOW');
  });

  test('throws when FOLDER_SPAM_HIGH is not configured', async () => {
    const ctx = fixtureContext({
      config: { FOLDER_SPAM_LOW: 'spam.low', FOLDER_SPAM_HIGH: '' },
    });

    await expect(
      moveToFolders(
        mockImap,
        { nonSpamMessages: [], lowSpamMessages: [], highSpamMessages: [] },
        ctx
      )
    ).rejects.toThrow('FOLDER_SPAM_HIGH');
  });
});
