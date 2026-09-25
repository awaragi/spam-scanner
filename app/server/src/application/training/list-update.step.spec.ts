import { describe, test, expect, vi, beforeEach } from 'vitest';
import { asImapFlow } from '../../../test/support/imap-fakes.js';

const { readMapState, writeMapState } = vi.hoisted(() => ({
  readMapState: vi.fn(),
  writeMapState: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../infrastructure/state/sender-list.repository.js', () => ({
  readMapState,
  writeMapState,
}));

import { updateListState } from './list-update.step.js';

describe('updateListState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    writeMapState.mockResolvedValue(true);
  });

  test('append mode merges with existing entries', async () => {
    readMapState.mockResolvedValue(['a@b.com']);

    const result = await updateListState(
      asImapFlow({}),
      'INBOX.scanner.state',
      'rspamd-whitelist-map',
      ['C@D.com', 'a@b.com'],
      'append'
    );

    expect(writeMapState).toHaveBeenCalledWith(
      {},
      'INBOX.scanner.state',
      'rspamd-whitelist-map',
      JSON.stringify(['a@b.com', 'c@d.com'], null, 2),
      undefined
    );
    expect(result.added).toEqual(['c@d.com']);
    expect(result.skipped).toEqual(['a@b.com']);
    expect(result.total).toBe(2);
  });

  test('override mode replaces existing entries entirely', async () => {
    readMapState.mockResolvedValue(['old@example.com']);

    const result = await updateListState(
      asImapFlow({}),
      'INBOX.scanner.state',
      'rspamd-blacklist-map',
      ['new@example.com'],
      'override'
    );

    expect(writeMapState).toHaveBeenCalledWith(
      {},
      'INBOX.scanner.state',
      'rspamd-blacklist-map',
      JSON.stringify(['new@example.com'], null, 2),
      undefined
    );
    expect(result.removed).toEqual(['old@example.com']);
    expect(result.total).toBe(1);
  });

  test('append mode is idempotent when run twice with the same input', async () => {
    readMapState.mockResolvedValueOnce([]);
    await updateListState(
      asImapFlow({}),
      'INBOX.scanner.state',
      'rspamd-whitelist-map',
      ['a@b.com'],
      'append'
    );
    const firstWrite = JSON.parse(writeMapState.mock.calls[0][3]);

    readMapState.mockResolvedValueOnce(firstWrite);
    await updateListState(
      asImapFlow({}),
      'INBOX.scanner.state',
      'rspamd-whitelist-map',
      ['a@b.com'],
      'append'
    );
    const secondWrite = JSON.parse(writeMapState.mock.calls[1][3]);

    expect(secondWrite).toEqual(firstWrite);
  });

  test('defaults to append mode when mode is omitted', async () => {
    readMapState.mockResolvedValue(['a@b.com']);

    await updateListState(
      asImapFlow({}),
      'INBOX.scanner.state',
      'rspamd-whitelist-map',
      ['b@c.com']
    );

    expect(writeMapState).toHaveBeenCalledWith(
      {},
      'INBOX.scanner.state',
      'rspamd-whitelist-map',
      JSON.stringify(['a@b.com', 'b@c.com'], null, 2),
      undefined
    );
  });
});
