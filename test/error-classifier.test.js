import { describe, test, expect } from 'vitest';
import { isPermanentError } from '../src/lib/utils/error-classifier.js';

describe('isPermanentError', () => {
  test('true when err.permanent === true', () => {
    const err = new Error('bad shape');
    err.permanent = true;
    expect(isPermanentError(err)).toBe(true);
  });

  test('true when err.status is a 4xx', () => {
    const err = new Error('bad request');
    err.status = 400;
    expect(isPermanentError(err)).toBe(true);

    const err2 = new Error('not found');
    err2.status = 404;
    expect(isPermanentError(err2)).toBe(true);

    const err3 = new Error('too many requests');
    err3.status = 499;
    expect(isPermanentError(err3)).toBe(true);
  });

  test('false when err.status is a 5xx', () => {
    const err = new Error('server error');
    err.status = 500;
    expect(isPermanentError(err)).toBe(false);
  });

  test('false when err.status is 400-adjacent but out of the 4xx range (e.g. 399, 500)', () => {
    const below = new Error('redirect');
    below.status = 399;
    expect(isPermanentError(below)).toBe(false);

    const above = new Error('server error');
    above.status = 500;
    expect(isPermanentError(above)).toBe(false);
  });

  test('false (transient default) when neither property is present - e.g. a plain network error', () => {
    const err = new Error('fetch failed');
    expect(isPermanentError(err)).toBe(false);
  });

  test('false for a falsy/undefined error', () => {
    expect(isPermanentError(undefined)).toBe(false);
    expect(isPermanentError(null)).toBe(false);
  });
});
