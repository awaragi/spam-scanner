import { validateState, formatStateAsEmail, parseStateFromEmail } from '../src/lib/utils/state-utils.js';
import {parseEmail} from "../src/lib/utils/email-parser.js";

describe('validateState', () => {
  test('should validate a valid state object', () => {
    const state = {
      last_uid: 100,
      last_seen_date: '2023-05-15T10:30:00.000Z',
      last_checked: '2023-05-15T10:30:00.000Z'
    };

    expect(validateState(state)).toBe(true);
  });

  test('should throw error for missing required properties', () => {
    const state = {
      last_uid: 100
    };

    expect(() => validateState(state)).toThrow('Invalid state: missing required properties');
  });

  test('should throw error for invalid property types', () => {
    const state = {
      last_uid: '100',
      last_seen_date: true,
      last_checked: 123
    };

    expect(() => validateState(state)).toThrow('Invalid state: invalid property types');
  });

  test('should throw error for invalid property name', () => {
    const state = {
      uid: '100',
      last_seen: '2023-05-15T10:30:00.000Z',
      checked: '2023-05-15T10:30:00.000Z'
    };

    expect(() => validateState(state)).toThrow('Invalid state: missing required properties');
  });


  test('should throw error for null state', () => {
    expect(() => validateState(null)).toThrow('Invalid state: must be a non-null object');
  });

  test('should throw error for non-object state', () => {
    expect(() => validateState('string')).toThrow('Invalid state: must be a non-null object');
    expect(() => validateState(123)).toThrow('Invalid state: must be a non-null object');
    expect(() => validateState(true)).toThrow('Invalid state: must be a non-null object');
  });
});

describe('formatStateAsEmail', () => {
  test('should format state as email', () => {
    const state = {
      last_uid: 100,
      last_seen_date: '2023-05-15T10:30:00.000Z',
      last_checked: '2023-05-15T10:30:00.000Z'
    };

    const stateKey = 'scanner';
    const result = formatStateAsEmail(state, stateKey);

    // Check that the result contains the expected headers
    expect(result).toContain('From: Scanner State <scanner@localhost>');
    expect(result).toContain('To: Scanner State <scanner@localhost>');
    expect(result).toContain(`Subject: AppState: ${stateKey}`);
    expect(result).toContain(`X-App-State: ${stateKey}`);
    expect(result).toContain('Content-Type: text/plain; charset=utf-8');
    expect(result).toContain('MIME-Version: 1.0');

    // Check that the result contains the state JSON
    expect(result).toContain(JSON.stringify(state, null, 2));
  });

  test('should throw error for invalid state', () => {
    expect(() => formatStateAsEmail(null, 'scanner')).toThrow('Invalid state: must be a non-null object');
  });
});
describe('parseStateFromEmail', () => {
  test('should parse state from email content', () => {
    const state = {
      last_uid: 100,
      last_seen_date: '2023-05-15T10:30:00.000Z',
      last_checked: '2023-05-15T10:30:00.000Z'
    };

    const {body} = parseEmail(JSON.stringify(state));
    const result = parseStateFromEmail(body);
    expect(result).toEqual(state);
  });

  test('should return null for invalid JSON', () => {
    const {body} = parseEmail('Invalid JSON');
    const result = parseStateFromEmail(body);
    expect(result).toBeNull();
  });

  test('should return null for missing body', () => {
    const {body} = parseEmail('');
    const result = parseStateFromEmail(body);
    expect(result).toBeNull();
  });
});