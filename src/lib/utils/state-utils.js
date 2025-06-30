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
 * Formats a state object as an email message
 * @param {Object} state - State object to format
 * @param {string} stateKey - Key to identify the state
 * @returns {string} - Formatted email message
 */
export function formatStateAsEmail(state, stateKey) {
  validateState(state);
  
  const stateJson = JSON.stringify(state, null, 2);

  // Ensure the email format is plain text with proper headers
  // and JSON content is directly in the body
  return `From: Scanner State <scanner@localhost>
To: Scanner State <scanner@localhost>
Subject: AppState: ${stateKey}
X-App-State: ${stateKey}
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0

${stateJson}`;
}

/**
 * Parses a state from email content
 * @param {string} emailContent - Email content containing state
 * @returns {Object|null} - Parsed state object or null if parsing failed
 */
export function parseStateFromEmail(emailContent) {
  try {
    // Extract the JSON part (after the headers)
    const headerEndIndex = emailContent.indexOf('\n\n');
    if (headerEndIndex === -1) return null;
    
    const jsonContent = emailContent.substring(headerEndIndex + 2).trim();
    return JSON.parse(jsonContent);
  } catch (e) {
    return null;
  }
}