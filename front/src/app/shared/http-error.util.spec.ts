import { describe, expect, it } from 'vitest';
import { httpErrorMessage } from './http-error.util';

describe('httpErrorMessage', () => {
  it('reads a NestJS-style {error: {message}} body', () => {
    expect(httpErrorMessage({ error: { message: 'Invalid password' } })).toBe('Invalid password');
  });

  it('joins an array-shaped message', () => {
    expect(httpErrorMessage({ error: { message: ['id is required', 'host is required'] } })).toBe(
      'id is required, host is required',
    );
  });

  it('falls back to a string error body', () => {
    expect(httpErrorMessage({ error: 'Unauthorized' })).toBe('Unauthorized');
  });

  it('falls back to the HttpErrorResponse message when no body message exists', () => {
    expect(httpErrorMessage({ message: 'Http failure response for /x: 0 Unknown Error' })).toBe(
      'Http failure response for /x: 0 Unknown Error',
    );
  });

  it('falls back to the default message for an unrecognized shape', () => {
    expect(httpErrorMessage({})).toBe('Something went wrong.');
    expect(httpErrorMessage(null)).toBe('Something went wrong.');
  });

  it('accepts a custom fallback', () => {
    expect(httpErrorMessage({}, 'Could not save.')).toBe('Could not save.');
  });
});
