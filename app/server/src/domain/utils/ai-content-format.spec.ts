import { describe, test, expect } from 'vitest';
import {
  formatAddressList,
  truncateToTokenBudget,
} from './ai-content-format.js';

describe('formatAddressList', () => {
  test('formats a named address as "Name <addr>"', () => {
    expect(
      formatAddressList([{ name: 'Alice', address: 'alice@example.com' }])
    ).toBe('Alice <alice@example.com>');
  });

  test('formats an address with no name as just the address', () => {
    expect(formatAddressList([{ address: 'alice@example.com' }])).toBe(
      'alice@example.com'
    );
  });

  test('joins multiple addresses with ", "', () => {
    expect(
      formatAddressList([
        { name: 'Alice', address: 'alice@example.com' },
        { address: 'bob@example.com' },
      ])
    ).toBe('Alice <alice@example.com>, bob@example.com');
  });

  test('defaults to an empty string when addresses is omitted', () => {
    expect(formatAddressList()).toBe('');
  });

  test('returns an empty string for a non-array input', () => {
    expect(formatAddressList(null)).toBe('');
  });

  test('filters out falsy/empty entries', () => {
    expect(
      formatAddressList([{ address: '' }, { address: 'bob@example.com' }])
    ).toBe('bob@example.com');
  });
});

describe('truncateToTokenBudget', () => {
  test('returns text unchanged when under budget', () => {
    expect(truncateToTokenBudget('short text', 100)).toBe('short text');
  });

  test('truncates and appends a marker when over budget', () => {
    const text = 'a'.repeat(50000);
    // 10 tokens * 4 chars/token = 40 chars
    expect(truncateToTokenBudget(text, 10)).toBe(
      `${'a'.repeat(40)}…[truncated]`
    );
  });

  test('returns an empty string for falsy text', () => {
    expect(truncateToTokenBudget('', 100)).toBe('');
    expect(truncateToTokenBudget(undefined, 100)).toBe('');
  });

  test('clamps a negative maxTokens to zero chars', () => {
    expect(truncateToTokenBudget('hello', -5)).toBe('…[truncated]');
  });
});
