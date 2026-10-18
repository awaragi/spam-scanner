import { describe, expect, it } from 'vitest';
import { isEmailShaped } from './email.util';

describe('isEmailShaped', () => {
  it('accepts an ordinary email address', () => {
    expect(isEmailShaped('pierre@awaragi.com')).toBe(true);
  });

  it('rejects a bare username', () => {
    expect(isEmailShaped('jdoe123')).toBe(false);
  });

  it('rejects an empty or whitespace-only value', () => {
    expect(isEmailShaped('')).toBe(false);
    expect(isEmailShaped('   ')).toBe(false);
  });

  it('rejects a value with no domain dot', () => {
    expect(isEmailShaped('jdoe@localhost')).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isEmailShaped('  pierre@awaragi.com  ')).toBe(true);
  });
});
