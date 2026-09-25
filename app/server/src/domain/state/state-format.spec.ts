import { describe, test, expect } from 'vitest';
import {
  validateState,
  formatStateAsEmail,
  formatAppStateEmail,
  parseStateFromEmail,
  STATE_KEY_SCANNER,
  STATE_KEY_WHITELIST_MAP,
  STATE_KEY_BLACKLIST_MAP,
} from './state-format.js';

describe('validateState', () => {
  test('should validate a valid state object', () => {
    const state = {
      last_uid: 100,
      last_seen_date: '2023-05-15T10:30:00.000Z',
      last_checked: '2023-05-15T10:30:00.000Z',
    };

    expect(validateState(state)).toBe(true);
  });

  test('should throw error for missing required properties', () => {
    const state = {
      last_uid: 100,
    };

    expect(() => validateState(state)).toThrow(
      'Invalid state: missing required properties'
    );
  });

  test('should throw error for invalid property types', () => {
    const state = {
      last_uid: '100',
      last_seen_date: true,
      last_checked: 123,
    };

    expect(() => validateState(state)).toThrow(
      'Invalid state: invalid property types'
    );
  });

  test('should throw error for invalid property name', () => {
    const state = {
      uid: '100',
      last_seen: '2023-05-15T10:30:00.000Z',
      checked: '2023-05-15T10:30:00.000Z',
    };

    expect(() => validateState(state)).toThrow(
      'Invalid state: missing required properties'
    );
  });

  test('should throw error for null state', () => {
    expect(() => validateState(null)).toThrow(
      'Invalid state: must be a non-null object'
    );
  });

  test('should accept an optional uid_validity string', () => {
    const state = {
      last_uid: 100,
      last_seen_date: '2023-05-15T10:30:00.000Z',
      last_checked: '2023-05-15T10:30:00.000Z',
      uid_validity: '1234567890',
    };

    expect(validateState(state)).toBe(true);
  });

  test('should throw error for non-string uid_validity', () => {
    const state = {
      last_uid: 100,
      last_seen_date: '2023-05-15T10:30:00.000Z',
      last_checked: '2023-05-15T10:30:00.000Z',
      uid_validity: 1234567890,
    };

    expect(() => validateState(state)).toThrow(
      'Invalid state: invalid property types'
    );
  });

  test('should throw error for non-object state', () => {
    expect(() => validateState('string')).toThrow(
      'Invalid state: must be a non-null object'
    );
    expect(() => validateState(123)).toThrow(
      'Invalid state: must be a non-null object'
    );
    expect(() => validateState(true)).toThrow(
      'Invalid state: must be a non-null object'
    );
  });
});

describe('formatStateAsEmail', () => {
  test('should format state as email', () => {
    const state = {
      last_uid: 100,
      last_seen_date: '2023-05-15T10:30:00.000Z',
      last_checked: '2023-05-15T10:30:00.000Z',
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
    expect(() => formatStateAsEmail(null, 'scanner')).toThrow(
      'Invalid state: must be a non-null object'
    );
  });
});

describe('formatAppStateEmail', () => {
  test('defaults the display name to "App State"', () => {
    const result = formatAppStateEmail('rspamd-whitelist-map', 'a@b.com');

    expect(result).toContain('From: App State <scanner@localhost>');
    expect(result).toContain('To: App State <scanner@localhost>');
    expect(result).toContain('Subject: AppState: rspamd-whitelist-map');
    expect(result).toContain('X-App-State: rspamd-whitelist-map');
    expect(result).toContain('a@b.com');
  });

  test('accepts a custom display name', () => {
    const result = formatAppStateEmail(
      'rspamd-whitelist-map',
      'a@b.com',
      'Map State'
    );

    expect(result).toContain('From: Map State <scanner@localhost>');
    expect(result).toContain('To: Map State <scanner@localhost>');
  });
});

describe('parseStateFromEmail', () => {
  test('should parse state from email content', () => {
    const state = {
      last_uid: 100,
      last_seen_date: '2023-05-15T10:30:00.000Z',
      last_checked: '2023-05-15T10:30:00.000Z',
    };

    const result = parseStateFromEmail(JSON.stringify(state));
    expect(result).toEqual(state);
  });

  test('should return null for invalid JSON', () => {
    const result = parseStateFromEmail('Invalid JSON');
    expect(result).toBeNull();
  });

  test('should return null for empty string', () => {
    const result = parseStateFromEmail('');
    expect(result).toBeNull();
  });
});

describe('state-key constants and byte-identical parity', () => {
  test('state-key constants have their original values', () => {
    expect(STATE_KEY_SCANNER).toBe('scanner');
    expect(STATE_KEY_WHITELIST_MAP).toBe('rspamd-whitelist-map');
    expect(STATE_KEY_BLACKLIST_MAP).toBe('rspamd-blacklist-map');
  });

  test('formatStateAsEmail produces the expected byte-identical format for known input', () => {
    const state = {
      last_uid: 100,
      last_seen_date: '2023-05-15T10:30:00.000Z',
      last_checked: '2023-05-15T10:30:00.000Z',
    };

    const output = formatStateAsEmail(state, 'scanner');

    // Expected output based on terminal's exact format
    const expectedJson = JSON.stringify(state, null, 2);
    const expected =
      `From: Scanner State <scanner@localhost>
To: Scanner State <scanner@localhost>
Subject: AppState: scanner
X-App-State: scanner
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0

${expectedJson}`;

    expect(output).toBe(expected);
  });

  test('formatAppStateEmail with custom displayName produces the expected format', () => {
    const body = 'test body content';
    const stateKey = 'rspamd-whitelist-map';
    const displayName = 'Map State';

    const output = formatAppStateEmail(stateKey, body, displayName);

    const expected = `From: Map State <scanner@localhost>
To: Map State <scanner@localhost>
Subject: AppState: rspamd-whitelist-map
X-App-State: rspamd-whitelist-map
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0

${body}`;

    expect(output).toBe(expected);
  });

  test('formatAppStateEmail with default displayName produces the expected format', () => {
    const body = 'some content';
    const stateKey = 'rspamd-blacklist-map';

    const output = formatAppStateEmail(stateKey, body);

    const expected = `From: App State <scanner@localhost>
To: App State <scanner@localhost>
Subject: AppState: rspamd-blacklist-map
X-App-State: rspamd-blacklist-map
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0

${body}`;

    expect(output).toBe(expected);
  });
});
