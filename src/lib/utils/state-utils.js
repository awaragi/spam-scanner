/**
 * Utility functions for state management
 */

/**
 * Validates a state object
 * @param {Object} state - State object to validate
 * @throws {Error} - If state is invalid
 * @returns {boolean} - True if state is valid
 */
export function validateState(state) {
  if (!state || typeof state !== 'object') {
    throw new Error('Invalid state: must be a non-null object');
  }

  const requiredProperties = ['last_uid', 'last_seen_date', 'last_checked'];
  const stateKeys = Object.keys(state);

  // Check for missing required properties
  const missingProperties = requiredProperties.filter(prop => !(prop in state));
  if (missingProperties.length > 0) {
    throw new Error('Invalid state: missing required properties');
  }

  // Check for invalid property names (extra properties not in required list)
  const invalidProperties = stateKeys.filter(key => !requiredProperties.includes(key));
  if (invalidProperties.length > 0) {
    throw new Error('Invalid state: invalid property names');
  }

  // Check property types
  if (typeof state.last_uid !== 'number') {
    throw new Error('Invalid state: invalid property types');
  }

  if (typeof state.last_seen_date !== 'string' || typeof state.last_checked !== 'string') {
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
export function formatAppStateEmail(
  stateKey,
  body,
  displayName = 'App State'
) {
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
  } catch (e) {
    return null;
  }
}