import { describe, test, expect } from 'vitest';
import {
  computeScanProgress,
  computeUidValidityReset,
  buildScanQuery,
} from '../../src/lib/services/scan-progress.service.js';

describe('computeScanProgress', () => {
  test('advances last_uid to the highest UID seen in the batch', () => {
    const state = { last_uid: 100 };
    const messages = [
      { uid: 101, envelope: { date: new Date('2024-01-01') } },
      { uid: 103, envelope: { date: new Date('2024-01-02') } },
      { uid: 102, envelope: { date: new Date('2024-01-01') } },
    ];

    const result = computeScanProgress(state, messages, () => 'now');

    expect(result.last_uid).toBe(103);
    expect(result.last_checked).toBe('now');
  });

  test('never regresses last_uid below the current state', () => {
    const state = { last_uid: 500 };
    const messages = [{ uid: 101, envelope: { date: new Date() } }];

    expect(computeScanProgress(state, messages).last_uid).toBe(500);
  });

  test('an empty batch leaves last_uid unchanged', () => {
    const state = { last_uid: 100 };
    expect(computeScanProgress(state, []).last_uid).toBe(100);
  });

  test('last_seen_date is the latest message date in the batch', () => {
    const state = { last_uid: 0 };
    const messages = [
      { uid: 1, envelope: { date: new Date('2024-01-01T00:00:00Z') } },
      { uid: 2, envelope: { date: new Date('2024-03-01T00:00:00Z') } },
      { uid: 3, envelope: { date: new Date('2024-02-01T00:00:00Z') } },
    ];

    expect(computeScanProgress(state, messages).last_seen_date).toBe(
      '2024-03-01T00:00:00.000Z'
    );
  });

  test('a message with an unparseable date does not affect last_seen_date', () => {
    const state = { last_uid: 0 };
    const messages = [
      { uid: 1, envelope: { date: new Date('2024-01-01T00:00:00Z') } },
      { uid: 2, envelope: { date: null } },
    ];

    expect(computeScanProgress(state, messages).last_seen_date).toBe(
      '2024-01-01T00:00:00.000Z'
    );
  });
});

describe('computeUidValidityReset', () => {
  test('no stored uid_validity (legacy state): stores the current one without resetting last_uid', () => {
    const state = { last_uid: 100 };
    const mailbox = { uidValidity: 111n, uidNext: 9999 };

    const result = computeUidValidityReset(state, mailbox);

    expect(result.changed).toBe(false);
    expect(result.state).toEqual({ last_uid: 100, uid_validity: '111' });
  });

  test('matching uid_validity: no reset', () => {
    const state = { last_uid: 100, uid_validity: '111' };
    const mailbox = { uidValidity: 111n, uidNext: 9999 };

    const result = computeUidValidityReset(state, mailbox);

    expect(result.changed).toBe(false);
    expect(result.state.last_uid).toBe(100);
  });

  test('mismatched uid_validity: resets last_uid to uidNext - 1', () => {
    const state = { last_uid: 9000, uid_validity: '111' };
    const mailbox = { uidValidity: 222n, uidNext: 6 };

    const result = computeUidValidityReset(state, mailbox);

    expect(result.changed).toBe(true);
    expect(result.previousUidValidity).toBe('111');
    expect(result.currentUidValidity).toBe('222');
    expect(result.state).toEqual({ last_uid: 5, uid_validity: '222' });
  });

  test('mismatched uid_validity with uidNext <= 1: resets to 0', () => {
    const state = { last_uid: 9000, uid_validity: '111' };
    const mailbox = { uidValidity: 222n, uidNext: 1 };

    const result = computeUidValidityReset(state, mailbox);

    expect(result.state.last_uid).toBe(0);
  });
});

describe('buildScanQuery', () => {
  test('builds a uid-range query starting after last_uid', () => {
    expect(buildScanQuery({ last_uid: 7384 }, true)).toEqual({
      uid: '7385:*',
    });
  });

  test('restricts to unseen messages when scanRead is false', () => {
    expect(buildScanQuery({ last_uid: 100 }, false)).toEqual({
      uid: '101:*',
      seen: false,
    });
  });
});
