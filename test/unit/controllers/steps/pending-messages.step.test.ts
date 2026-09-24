import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.ts';
import { asImapFlow } from '../../../support/imap-fakes.ts';

vi.mock('../../../../src/lib/clients/state-manager.client.ts', () => ({
  readScannerState: vi.fn(),
  writeScannerState: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../../../src/lib/clients/imap.client.ts', () => ({
  open: vi.fn(),
  search: vi.fn(),
}));

import { locatePendingMessages } from '../../../../src/lib/controllers/steps/pending-messages.step.ts';
import {
  readScannerState,
  writeScannerState,
} from '../../../../src/lib/clients/state-manager.client.ts';
import { open, search } from '../../../../src/lib/clients/imap.client.ts';

const mockedReadScannerState = vi.mocked(readScannerState);
const mockedWriteScannerState = vi.mocked(writeScannerState);
const mockedOpen = vi.mocked(open);
const mockedSearch = vi.mocked(search);
const mockImap = asImapFlow({});

describe('locatePendingMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedOpen.mockResolvedValue({
      uidValidity: 1n,
      uidNext: 200,
    } as Awaited<ReturnType<typeof open>>);
    mockedSearch.mockResolvedValue([]);
  });

  test('IMAP range inversion: search returns only lastUID, no messages are pending', async () => {
    const ctx = fixtureContext();
    mockedReadScannerState.mockResolvedValue({
      last_uid: 7384,
      last_seen_date: '',
      last_checked: '',
    });
    mockedSearch.mockResolvedValue([7384]); // server wraps 7385:* -> [7384]

    const result = await locatePendingMessages(mockImap, ctx);

    expect(result).toEqual({
      state: expect.objectContaining({ last_uid: 7384 }),
      uids: [],
    });
  });

  test('normal case: search returns UIDs greater than lastUID, all are returned', async () => {
    const ctx = fixtureContext();
    mockedReadScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    mockedSearch.mockResolvedValue([101, 102, 103]);

    const result = await locatePendingMessages(mockImap, ctx);

    expect(result.uids).toEqual([101, 102, 103]);
  });

  test('mixed case: only UIDs greater than lastUID are returned', async () => {
    const ctx = fixtureContext();
    mockedReadScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    mockedSearch.mockResolvedValue([100, 101, 102]);

    const result = await locatePendingMessages(mockImap, ctx);

    expect(result.uids).toEqual([101, 102]);
  });

  test('caps the result to BATCH_SCAN_SIZE', async () => {
    const ctx = fixtureContext({ config: { BATCH_SCAN_SIZE: 2 } });
    mockedReadScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    mockedSearch.mockResolvedValue([101, 102, 103]);

    const result = await locatePendingMessages(mockImap, ctx);

    expect(result.uids).toEqual([101, 102]);
  });

  test('mismatched uid_validity: resets to UIDNEXT - 1 instead of the stale last_uid', async () => {
    const ctx = fixtureContext();
    mockedReadScannerState.mockResolvedValue({
      last_uid: 9000,
      last_seen_date: '',
      last_checked: '',
      uid_validity: '111',
    });
    mockedOpen.mockResolvedValue({ uidValidity: 222n, uidNext: 6 } as Awaited<ReturnType<typeof open>>);
    mockedSearch.mockResolvedValue([]);

    const result = await locatePendingMessages(mockImap, ctx);

    expect(result).toEqual({
      state: expect.objectContaining({ last_uid: 5, uid_validity: '222' }),
      uids: [],
    });
    // Persisted immediately even though nothing new was found, so the next
    // cycle doesn't re-detect the same mismatch and warn again.
    expect(mockedWriteScannerState).toHaveBeenCalledWith(
      mockImap,
      expect.objectContaining({ last_uid: 5, uid_validity: '222' })
    );
  });

  test('no UIDVALIDITY change and nothing new: state is not persisted', async () => {
    const ctx = fixtureContext();
    mockedReadScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
      uid_validity: '1',
    });
    mockedOpen.mockResolvedValue({ uidValidity: 1n, uidNext: 101 } as Awaited<ReturnType<typeof open>>);
    mockedSearch.mockResolvedValue([]);

    await locatePendingMessages(mockImap, ctx);

    expect(mockedWriteScannerState).not.toHaveBeenCalled();
  });
});
