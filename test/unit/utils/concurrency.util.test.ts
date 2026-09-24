import { describe, test, expect } from 'vitest';
import { mapWithConcurrency } from '../../../src/lib/utils/concurrency.util.ts';

describe('mapWithConcurrency', () => {
  test('returns results in the same order as the input items', async () => {
    const items = [1, 2, 3, 4, 5];
    const result = await mapWithConcurrency(items, 2, async n => n * 2);
    expect(result).toEqual([2, 4, 6, 8, 10]);
  });

  test('never runs more than `limit` items concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency([1, 2, 3, 4, 5], 2, async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  test('handles an empty items array', async () => {
    const result = await mapWithConcurrency([], 5, async n => n);
    expect(result).toEqual([]);
  });

  test('a limit larger than the item count runs everything at once', async () => {
    const result = await mapWithConcurrency([1, 2, 3], 100, async n => n + 1);
    expect(result).toEqual([2, 3, 4]);
  });
});
