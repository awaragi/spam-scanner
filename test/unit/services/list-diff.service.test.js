import { describe, test, expect } from 'vitest';
import { diffListUpdate } from '../../../src/lib/services/list-diff.service.js';

describe('diffListUpdate', () => {
  test('append mode merges with existing entries', () => {
    const result = diffListUpdate(
      ['a@b.com'],
      ['C@D.com', 'a@b.com'],
      'append'
    );

    expect(result.list).toEqual(['a@b.com', 'c@d.com']);
    expect(result.added).toEqual(['c@d.com']);
    expect(result.skipped).toEqual(['a@b.com']);
    expect(result.removed).toEqual([]);
    expect(result.total).toBe(2);
  });

  test('override mode replaces existing entries entirely', () => {
    const result = diffListUpdate(
      ['old@example.com'],
      ['new@example.com'],
      'override'
    );

    expect(result.list).toEqual(['new@example.com']);
    expect(result.removed).toEqual(['old@example.com']);
    expect(result.total).toBe(1);
  });

  test('defaults to append mode when mode is omitted', () => {
    const result = diffListUpdate(['a@b.com'], ['b@c.com']);
    expect(result.list).toEqual(['a@b.com', 'b@c.com']);
  });

  test('is idempotent when run twice with the same input', () => {
    const first = diffListUpdate([], ['a@b.com'], 'append');
    const second = diffListUpdate(first.list, ['a@b.com'], 'append');
    expect(second.list).toEqual(first.list);
  });
});
