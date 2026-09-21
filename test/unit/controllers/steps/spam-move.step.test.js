import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.js';

vi.mock('../../../../src/lib/clients/imap.client.js', () => ({
  moveMessages: vi.fn().mockResolvedValue(),
}));

import { moveConfirmedSpam } from '../../../../src/lib/controllers/steps/spam-move.step.js';
import { moveMessages } from '../../../../src/lib/clients/imap.client.js';

const mockImap = {};

describe('moveConfirmedSpam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('moves the given messages to FOLDER_SPAM', async () => {
    const ctx = fixtureContext({ config: { FOLDER_SPAM: 'INBOX.spam' } });
    const spamMessages = [{ uid: 1 }, { uid: 2 }];

    await moveConfirmedSpam(mockImap, spamMessages, ctx);

    expect(moveMessages).toHaveBeenCalledWith(
      mockImap,
      spamMessages,
      'INBOX.spam'
    );
  });

  test('an empty list still calls through (moveMessages owns the no-op case)', async () => {
    const ctx = fixtureContext();

    await moveConfirmedSpam(mockImap, [], ctx);

    expect(moveMessages).toHaveBeenCalledWith(
      mockImap,
      [],
      ctx.config.FOLDER_SPAM
    );
  });
});
