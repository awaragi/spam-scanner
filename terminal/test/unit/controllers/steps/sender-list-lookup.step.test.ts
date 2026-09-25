import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.ts';
import { asImapFlow } from '../../../support/imap-fakes.ts';

vi.mock('../../../../src/lib/clients/state-manager.client.ts', () => ({
  readMapState: vi.fn(),
}));

import { loadSenderLists } from '../../../../src/lib/controllers/steps/sender-list-lookup.step.ts';
import { readMapState } from '../../../../src/lib/clients/state-manager.client.ts';

const mockedReadMapState = vi.mocked(readMapState);
const mockImap = asImapFlow({});

describe('loadSenderLists', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('reads whitelist and blacklist by their configured state keys, returning Sets', async () => {
    const ctx = fixtureContext({
      config: {
        STATE_KEY_WHITELIST_MAP: 'whitelist-key',
        STATE_KEY_BLACKLIST_MAP: 'blacklist-key',
      },
    });
    mockedReadMapState.mockImplementation((imap, key) =>
      Promise.resolve(
        key === 'whitelist-key' ? ['trusted@example.com'] : ['bad@evil.com']
      )
    );

    const result = await loadSenderLists(mockImap, ctx);

    expect(result.whitelistSet).toEqual(new Set(['trusted@example.com']));
    expect(result.blacklistSet).toEqual(new Set(['bad@evil.com']));
  });

  test('reads sequentially: whitelist before blacklist', async () => {
    const ctx = fixtureContext();
    const callOrder: string[] = [];
    mockedReadMapState.mockImplementation((imap, key) => {
      callOrder.push(key);
      return Promise.resolve([]);
    });

    await loadSenderLists(mockImap, ctx);

    expect(callOrder).toEqual([
      ctx.config.STATE_KEY_WHITELIST_MAP,
      ctx.config.STATE_KEY_BLACKLIST_MAP,
    ]);
  });

  test('empty state produces empty Sets', async () => {
    const ctx = fixtureContext();
    mockedReadMapState.mockResolvedValue([]);

    const result = await loadSenderLists(mockImap, ctx);

    expect(result.whitelistSet.size).toBe(0);
    expect(result.blacklistSet.size).toBe(0);
  });
});
