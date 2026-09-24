import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.ts';

vi.mock('../../../../src/lib/clients/imap.client.ts', () => ({
  waitForNewMail: vi.fn().mockResolvedValue(),
}));

import { runIdle } from '../../../../src/lib/controllers/workflows/idle.controller.ts';
import { waitForNewMail } from '../../../../src/lib/clients/imap.client.ts';

const mockImap = {};

describe('runIdle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('is a thin pass-through to imap.client.js waitForNewMail with ctx.config.FOLDER_INBOX', async () => {
    const ctx = fixtureContext({ config: { FOLDER_INBOX: 'INBOX' } });
    const options = { lastUid: 5 };

    await runIdle(mockImap, options, ctx);

    expect(waitForNewMail).toHaveBeenCalledWith(mockImap, 'INBOX', options);
  });
});
