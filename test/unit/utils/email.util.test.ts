import { describe, test, expect } from 'vitest';
import { dateToString } from '../../../src/lib/utils/email.util.ts';

describe('dateToString', () => {
  test('converts a Date to an ISO string', () => {
    expect(dateToString(new Date('2024-01-01T00:00:00Z'))).toBe(
      '2024-01-01T00:00:00.000Z'
    );
  });

  test('returns an empty string for a falsy value', () => {
    expect(dateToString(null)).toBe('');
    expect(dateToString(undefined)).toBe('');
  });

  test('returns an empty string if toISOString throws', () => {
    expect(
      dateToString({
        toISOString: () => {
          throw new Error('bad');
        },
      })
    ).toBe('');
  });
});
