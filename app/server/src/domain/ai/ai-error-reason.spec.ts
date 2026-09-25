import { describe, test, expect } from 'vitest';
import {
  AuthenticationError,
  RateLimitError,
  APIConnectionError,
  APIConnectionTimeoutError,
  InternalServerError,
} from 'openai';
import { categorizeAiError } from './ai-error-reason.js';

describe('categorizeAiError', () => {
  test('maps each openai SDK error subclass to its constructor name', () => {
    expect(
      categorizeAiError(
        new AuthenticationError(
          401,
          { error: { message: 'bad key' } },
          'Unauthorized',
          new Headers()
        )
      )
    ).toBe('AuthenticationError');
    expect(
      categorizeAiError(
        new RateLimitError(
          429,
          { error: { message: 'slow down' } },
          'Too many requests',
          new Headers()
        )
      )
    ).toBe('RateLimitError');
    expect(
      categorizeAiError(
        new APIConnectionError({ message: 'Connection error.' })
      )
    ).toBe('APIConnectionError');
    expect(categorizeAiError(new APIConnectionTimeoutError())).toBe(
      'APIConnectionTimeoutError'
    );
    expect(
      categorizeAiError(
        new InternalServerError(
          500,
          { error: { message: 'oops' } },
          'Internal server error',
          new Headers()
        )
      )
    ).toBe('InternalServerError');
  });

  test('collapses "empty response" failures to the same code regardless of message', () => {
    expect(
      categorizeAiError(new Error('Empty response from AI provider'))
    ).toBe('empty_response');
  });

  test('collapses "invalid JSON" failures to the same code despite varying interpolated detail', () => {
    const a = categorizeAiError(
      new Error(
        'AI response is not valid JSON: Unexpected token < in JSON at position 0'
      )
    );
    const b = categorizeAiError(
      new Error('AI response is not valid JSON: Unexpected end of JSON input')
    );
    expect(a).toBe('invalid_json');
    expect(b).toBe('invalid_json');
  });

  test('collapses "missing score" failures to the same code despite varying interpolated reply text', () => {
    const a = categorizeAiError(
      new Error(
        'AI response missing numeric "score" field: {"reasoning":"looks fine"}'
      )
    );
    const b = categorizeAiError(
      new Error('AI response missing numeric "score" field: not even json')
    );
    expect(a).toBe('missing_score');
    expect(b).toBe('missing_score');
  });

  test('falls back to "unknown" for an unrecognized error', () => {
    expect(categorizeAiError(new TypeError('something else broke'))).toBe(
      'unknown'
    );
  });
});
