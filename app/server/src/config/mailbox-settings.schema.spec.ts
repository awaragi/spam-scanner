import { describe, test, expect, vi } from 'vitest';
import { overridableSchema, validateOverrides } from './mailbox-settings.schema.js';

describe('overridableSchema', () => {
  test('a message overriding only thresholds.clean parses without requiring low/confirmed', () => {
    const result = overridableSchema.parse({ thresholds: { clean: 30 } });

    expect(result).toEqual({ thresholds: { clean: 30 } });
  });

  test('thresholds.clean with the wrong type fails validation', () => {
    expect(() =>
      overridableSchema.parse({ thresholds: { clean: 'thirty' } })
    ).toThrow();
  });

  test('every top-level key is optional - an empty object parses', () => {
    expect(overridableSchema.parse({})).toEqual({});
  });
});

describe('validateOverrides', () => {
  test('undefined input passes through as undefined with no logging', () => {
    const warn = vi.fn();

    const result = validateOverrides(undefined, { warn } as any);

    expect(result).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  test('a valid key alongside a global-only top-level key: only the valid key survives, warning logged for the other', () => {
    const warn = vi.fn();

    const result = validateOverrides(
      { thresholds: { clean: 40 }, scanInterval: 600 },
      { warn } as any,
      'mailbox@example.com'
    );

    expect(result).toEqual({ thresholds: { clean: 40 } });
    expect(warn).toHaveBeenCalledWith(
      { mailboxId: 'mailbox@example.com', key: 'scanInterval' },
      'Ignoring unrecognized or global-only settings key'
    );
  });

  test('a type error on a recognized key throws', () => {
    expect(() =>
      validateOverrides({ thresholds: { clean: 'thirty' } })
    ).toThrow();
  });

  test('an unrecognized key nested inside a recognized group is dropped with a warning, other nested keys still apply', () => {
    const warn = vi.fn();

    const result = validateOverrides(
      { thresholds: { clean: 40, rspamdUser: 'nope' } as Record<string, unknown> },
      { warn } as any,
      'mailbox@example.com'
    );

    expect(result).toEqual({ thresholds: { clean: 40 } });
    expect(warn).toHaveBeenCalledWith(
      { mailboxId: 'mailbox@example.com', key: 'thresholds.rspamdUser' },
      'Ignoring unrecognized or global-only settings key'
    );
  });

  test('multiple valid overrides across groups all survive together', () => {
    const result = validateOverrides({
      folders: { spam: 'INBOX.custom-spam' },
      thresholds: { clean: 40 },
      aiEnabled: false,
    });

    expect(result).toEqual({
      folders: { spam: 'INBOX.custom-spam' },
      thresholds: { clean: 40 },
      aiEnabled: false,
    });
  });

  test('works with no logger passed at all', () => {
    expect(() =>
      validateOverrides({ scanInterval: 600 })
    ).not.toThrow();
  });
});
