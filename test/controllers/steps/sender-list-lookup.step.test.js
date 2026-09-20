import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../support/fixtures.js';

vi.mock('../../../src/lib/clients/state-manager.client.js', () => ({
  readMapState: vi.fn(),
}));

import { loadSenderLists } from '../../../src/lib/controllers/steps/sender-list-lookup.step.js';
import { readMapState } from '../../../src/lib/clients/state-manager.client.js';

const mockImap = {};

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
    readMapState.mockImplementation((imap, key) =>
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
    const callOrder = [];
    readMapState.mockImplementation((imap, key) => {
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
    readMapState.mockResolvedValue([]);

    const result = await loadSenderLists(mockImap, ctx);

    expect(result.whitelistSet.size).toBe(0);
    expect(result.blacklistSet.size).toBe(0);
  });
});
