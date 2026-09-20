import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../support/fixtures.js';

vi.mock('../../../src/lib/clients/imap.client.js', () => ({
  updateLabels: vi.fn().mockResolvedValue(),
}));

import { applyLabels } from '../../../src/lib/controllers/steps/label-apply.step.js';
import { updateLabels } from '../../../src/lib/clients/imap.client.js';

const mockImap = {};

describe('applyLabels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('resets spam labels on non-spam messages', async () => {
    const ctx = fixtureContext({
      config: { LABEL_SPAM_LOW: 'Spam:Low', LABEL_SPAM_HIGH: 'Spam:High' },
    });
    const nonSpamMessages = [{ uid: 1 }];

    await applyLabels(
      mockImap,
      { nonSpamMessages, lowSpamMessages: [], highSpamMessages: [] },
      ctx
    );

    expect(updateLabels).toHaveBeenCalledWith(
      mockImap,
      nonSpamMessages,
      [],
      ['Spam:Low', 'Spam:High']
    );
  });

  test('applies Spam:Low to low-spam messages, unsetting Spam:High', async () => {
    const ctx = fixtureContext({
      config: { LABEL_SPAM_LOW: 'Spam:Low', LABEL_SPAM_HIGH: 'Spam:High' },
    });
    const lowSpamMessages = [{ uid: 2 }];

    await applyLabels(
      mockImap,
      { nonSpamMessages: [], lowSpamMessages, highSpamMessages: [] },
      ctx
    );

    expect(updateLabels).toHaveBeenCalledWith(
      mockImap,
      lowSpamMessages,
      ['Spam:Low'],
      ['Spam:High']
    );
  });

  test('applies Spam:High to high-spam messages, unsetting Spam:Low', async () => {
    const ctx = fixtureContext({
      config: { LABEL_SPAM_LOW: 'Spam:Low', LABEL_SPAM_HIGH: 'Spam:High' },
    });
    const highSpamMessages = [{ uid: 3 }];

    await applyLabels(
      mockImap,
      { nonSpamMessages: [], lowSpamMessages: [], highSpamMessages },
      ctx
    );

    expect(updateLabels).toHaveBeenCalledWith(
      mockImap,
      highSpamMessages,
      ['Spam:High'],
      ['Spam:Low']
    );
  });

  test('reads label names fresh from ctx.config on every call - no module-load-time capture', async () => {
    const first = fixtureContext({
      config: { LABEL_SPAM_LOW: 'First:Low', LABEL_SPAM_HIGH: 'First:High' },
    });
    await applyLabels(
      mockImap,
      {
        nonSpamMessages: [],
        lowSpamMessages: [{ uid: 1 }],
        highSpamMessages: [],
      },
      first
    );
    expect(updateLabels).toHaveBeenCalledWith(
      mockImap,
      [{ uid: 1 }],
      ['First:Low'],
      ['First:High']
    );

    vi.clearAllMocks();

    const second = fixtureContext({
      config: { LABEL_SPAM_LOW: 'Second:Low', LABEL_SPAM_HIGH: 'Second:High' },
    });
    await applyLabels(
      mockImap,
      {
        nonSpamMessages: [],
        lowSpamMessages: [{ uid: 1 }],
        highSpamMessages: [],
      },
      second
    );
    expect(updateLabels).toHaveBeenCalledWith(
      mockImap,
      [{ uid: 1 }],
      ['Second:Low'],
      ['Second:High']
    );
  });
});
