import { describe, test, expect, vi, beforeEach } from 'vitest';

const { readMapState, writeMapState } = vi.hoisted(() => ({
  readMapState: vi.fn(),
  writeMapState: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/lib/clients/state-manager.client.js', () => ({
  readMapState,
  writeMapState,
}));

import { updateListState } from '../../../src/lib/controllers/steps/list-update.step.js';

describe('updateListState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeMapState.mockResolvedValue(true);
  });

  test('append mode merges with existing entries', async () => {
    readMapState.mockResolvedValue(['a@b.com']);

    const result = await updateListState(
      {},
      'rspamd-whitelist-map',
      ['C@D.com', 'a@b.com'],
      'append'
    );

    expect(writeMapState).toHaveBeenCalledWith(
      {},
      'rspamd-whitelist-map',
      JSON.stringify(['a@b.com', 'c@d.com'], null, 2)
    );
    expect(result.added).toEqual(['c@d.com']);
    expect(result.skipped).toEqual(['a@b.com']);
    expect(result.total).toBe(2);
  });

  test('override mode replaces existing entries entirely', async () => {
    readMapState.mockResolvedValue(['old@example.com']);

    const result = await updateListState(
      {},
      'rspamd-blacklist-map',
      ['new@example.com'],
      'override'
    );

    expect(writeMapState).toHaveBeenCalledWith(
      {},
      'rspamd-blacklist-map',
      JSON.stringify(['new@example.com'], null, 2)
    );
    expect(result.removed).toEqual(['old@example.com']);
    expect(result.total).toBe(1);
  });

  test('append mode is idempotent when run twice with the same input', async () => {
    readMapState.mockResolvedValueOnce([]);
    await updateListState({}, 'rspamd-whitelist-map', ['a@b.com'], 'append');
    const firstWrite = JSON.parse(writeMapState.mock.calls[0][2]);

    readMapState.mockResolvedValueOnce(firstWrite);
    await updateListState({}, 'rspamd-whitelist-map', ['a@b.com'], 'append');
    const secondWrite = JSON.parse(writeMapState.mock.calls[1][2]);

    expect(secondWrite).toEqual(firstWrite);
  });

  test('defaults to append mode when mode is omitted', async () => {
    readMapState.mockResolvedValue(['a@b.com']);

    await updateListState({}, 'rspamd-whitelist-map', ['b@c.com']);

    expect(writeMapState).toHaveBeenCalledWith(
      {},
      'rspamd-whitelist-map',
      JSON.stringify(['a@b.com', 'b@c.com'], null, 2)
    );
  });
});
