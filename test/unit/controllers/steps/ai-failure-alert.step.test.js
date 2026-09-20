import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.js';

vi.mock('../../../../src/lib/clients/imap.client.js', () => ({
  appendMessage: vi.fn().mockResolvedValue(),
}));
vi.mock('../../../../src/lib/clients/rspamd.client.js', () => ({
  learnHam: vi.fn().mockResolvedValue(),
}));

import { postAiFailureAlert } from '../../../../src/lib/controllers/steps/ai-failure-alert.step.js';
import { appendMessage } from '../../../../src/lib/clients/imap.client.js';
import { learnHam } from '../../../../src/lib/clients/rspamd.client.js';

const mockImap = {};

function fixtureAlert(overrides = {}) {
  return {
    reason: 'provider timeout',
    count: 3,
    lastError: 'provider timeout',
    lastAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('postAiFailureAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appendMessage.mockResolvedValue();
    learnHam.mockResolvedValue();
  });

  test('a null alert is a no-op: nothing appended, nothing trained', async () => {
    const ctx = fixtureContext();

    await postAiFailureAlert(mockImap, null, ctx);

    expect(appendMessage).not.toHaveBeenCalled();
    expect(learnHam).not.toHaveBeenCalled();
  });

  test('appends the alert to FOLDER_INBOX, marks the tracker notified, and trains rspamd ham on it', async () => {
    const ctx = fixtureContext({ config: { FOLDER_INBOX: 'INBOX' } });
    vi.spyOn(ctx.aiFailureTracker, 'markNotified');
    const alert = fixtureAlert();

    await postAiFailureAlert(mockImap, alert, ctx);

    expect(appendMessage).toHaveBeenCalledTimes(1);
    const [imapArg, folderArg, rawArg] = appendMessage.mock.calls[0];
    expect(imapArg).toBe(mockImap);
    expect(folderArg).toBe('INBOX');
    expect(rawArg).toContain('provider timeout');
    expect(ctx.aiFailureTracker.markNotified).toHaveBeenCalledWith(
      alert.reason
    );
    expect(learnHam).toHaveBeenCalledWith(rawArg);
  });

  test('an appendMessage failure is swallowed: never marks notified, never trains, never throws', async () => {
    const ctx = fixtureContext();
    vi.spyOn(ctx.aiFailureTracker, 'markNotified');
    appendMessage.mockRejectedValue(new Error('IMAP append failed'));

    await expect(
      postAiFailureAlert(mockImap, fixtureAlert(), ctx)
    ).resolves.toBeUndefined();

    expect(ctx.aiFailureTracker.markNotified).not.toHaveBeenCalled();
    expect(learnHam).not.toHaveBeenCalled();
  });

  test('a learnHam failure is swallowed: the alert is still considered posted', async () => {
    const ctx = fixtureContext();
    vi.spyOn(ctx.aiFailureTracker, 'markNotified');
    learnHam.mockRejectedValue(new Error('rspamd unreachable'));

    await expect(
      postAiFailureAlert(mockImap, fixtureAlert(), ctx)
    ).resolves.toBeUndefined();

    expect(ctx.aiFailureTracker.markNotified).toHaveBeenCalled();
  });
});
