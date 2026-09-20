import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.js';

vi.mock('../../../../src/lib/clients/state-manager.client.js', () => ({
  readScannerState: vi.fn(),
  writeScannerState: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../../../src/lib/clients/imap.client.js', () => ({
  open: vi.fn(),
  search: vi.fn(),
}));

import { locatePendingMessages } from '../../../../src/lib/controllers/steps/pending-messages.step.js';
import {
  readScannerState,
  writeScannerState,
} from '../../../../src/lib/clients/state-manager.client.js';
import { open, search } from '../../../../src/lib/clients/imap.client.js';

const mockImap = {};

describe('locatePendingMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    open.mockResolvedValue({ uidValidity: 1n, uidNext: 200 });
    search.mockResolvedValue([]);
  });

  test('IMAP range inversion: search returns only lastUID, no messages are pending', async () => {
    const ctx = fixtureContext();
    readScannerState.mockResolvedValue({
      last_uid: 7384,
      last_seen_date: '',
      last_checked: '',
    });
    search.mockResolvedValue([7384]); // server wraps 7385:* -> [7384]

    const result = await locatePendingMessages(mockImap, ctx);

    expect(result).toEqual({
      state: expect.objectContaining({ last_uid: 7384 }),
      uids: [],
    });
  });

  test('normal case: search returns UIDs greater than lastUID, all are returned', async () => {
    const ctx = fixtureContext();
    readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    search.mockResolvedValue([101, 102, 103]);

    const result = await locatePendingMessages(mockImap, ctx);

    expect(result.uids).toEqual([101, 102, 103]);
  });

  test('mixed case: only UIDs greater than lastUID are returned', async () => {
    const ctx = fixtureContext();
    readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    search.mockResolvedValue([100, 101, 102]);

    const result = await locatePendingMessages(mockImap, ctx);

    expect(result.uids).toEqual([101, 102]);
  });

  test('caps the result to SCAN_BATCH_SIZE', async () => {
    const ctx = fixtureContext({ config: { SCAN_BATCH_SIZE: 2 } });
    readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    search.mockResolvedValue([101, 102, 103]);

    const result = await locatePendingMessages(mockImap, ctx);

    expect(result.uids).toEqual([101, 102]);
  });

  test('mismatched uid_validity: resets to UIDNEXT - 1 instead of the stale last_uid', async () => {
    const ctx = fixtureContext();
    readScannerState.mockResolvedValue({
      last_uid: 9000,
      last_seen_date: '',
      last_checked: '',
      uid_validity: '111',
    });
    open.mockResolvedValue({ uidValidity: 222n, uidNext: 6 });
    search.mockResolvedValue([]);

    const result = await locatePendingMessages(mockImap, ctx);

    expect(result).toEqual({
      state: expect.objectContaining({ last_uid: 5, uid_validity: '222' }),
      uids: [],
    });
    // Persisted immediately even though nothing new was found, so the next
    // cycle doesn't re-detect the same mismatch and warn again.
    expect(writeScannerState).toHaveBeenCalledWith(
      mockImap,
      expect.objectContaining({ last_uid: 5, uid_validity: '222' })
    );
  });

  test('no UIDVALIDITY change and nothing new: state is not persisted', async () => {
    const ctx = fixtureContext();
    readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
      uid_validity: '1',
    });
    open.mockResolvedValue({ uidValidity: 1n, uidNext: 101 });
    search.mockResolvedValue([]);

    await locatePendingMessages(mockImap, ctx);

    expect(writeScannerState).not.toHaveBeenCalled();
  });
});
