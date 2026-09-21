/**
 * Utility functions for state management
 */

/**
 * Validates a state object
 * @param {Object} state - State object to validate
 * @throws {Error} - If state is invalid
 * @returns {boolean} - True if state is valid
 */
const REQUIRED_STATE_PROPERTIES = [
  'last_uid',
  'last_seen_date',
  'last_checked',
];
// Additive, optional fields - schema evolution should extend this list rather
// than break existing stored state (see finding 6.17). uid_validity is a
// string because IMAP UIDVALIDITY is a BigInt in imapflow and JSON.stringify
// can't serialize BigInt directly.
const OPTIONAL_STATE_PROPERTIES = ['uid_validity'];

export function validateState(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('Invalid state: must be a non-null object');
  }

  const stateKeys = Object.keys(state);

  // Check for missing required properties
  const missingProperties = REQUIRED_STATE_PROPERTIES.filter(
    prop => !(prop in state)
  );
  if (missingProperties.length > 0) {
    throw new Error('Invalid state: missing required properties');
  }

  // Check for invalid property names (extra properties not in the known list)
  const allowedProperties = [
    ...REQUIRED_STATE_PROPERTIES,
    ...OPTIONAL_STATE_PROPERTIES,
  ];
  const invalidProperties = stateKeys.filter(
    key => !allowedProperties.includes(key)
  );
  if (invalidProperties.length > 0) {
    throw new Error('Invalid state: invalid property names');
  }

  // Check property types
  if (typeof state.last_uid !== 'number') {
    throw new Error('Invalid state: invalid property types');
  }

  if (
    typeof state.last_seen_date !== 'string' ||
    typeof state.last_checked !== 'string'
  ) {
    throw new Error('Invalid state: invalid property types');
  }

  if (
    state.uid_validity !== undefined &&
    typeof state.uid_validity !== 'string'
  ) {
    throw new Error('Invalid state: invalid property types');
  }

  return true;
}

/**
 * Formats an app-state body (JSON state or raw map content) as an email
 * message, using the shared X-App-State envelope both scanner state and
 * map-state backups rely on to be found again by `search`.
 * @param {string} stateKey - Key to identify the state
 * @param {string} body - Raw text to place in the message body
 * @param {string} [displayName] - From/To display name
 * @returns {string} - Formatted email message
 */
export function formatAppStateEmail(stateKey, body, displayName = 'App State') {
  return `From: ${displayName} <scanner@localhost>
To: ${displayName} <scanner@localhost>
Subject: AppState: ${stateKey}
X-App-State: ${stateKey}
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0

${body}`;
}

/**
 * Formats a state object as an email message
 * @param {Object} state - State object to format
 * @param {string} stateKey - Key to identify the state
 * @returns {string} - Formatted email message
 */
export function formatStateAsEmail(state, stateKey) {
  validateState(state);

  const stateJson = JSON.stringify(state, null, 2);

  return formatAppStateEmail(stateKey, stateJson, 'Scanner State');
}

/**
 * Parses a state from email content
 * @param {string} emailContent - Email content containing state
 * @returns {Object|null} - Parsed state object or null if parsing failed
 */
export function parseStateFromEmail(emailContent) {
  try {
    return JSON.parse(emailContent);
  } catch {
    return null;
  }
}
