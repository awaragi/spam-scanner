/**
 * Utility functions for parsing and processing email content
 */

/**
 * Removes all X-Spam-* and X-Ham-Report headers from email content
 * @param {string} emailContent - Raw email content
 * @returns {string} - Email content without spam/ham headers
 */
export function stripSpamHeaders(emailContent) {
  const lines = emailContent.split('\n');
  const filteredLines = [];
  let skipNextLines = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // Check if this line starts a header we want to remove
    if (lowerLine.startsWith('x-spam-') || lowerLine.startsWith('x-ham-report')) {
      skipNextLines = true;
      continue;
    }

    // Check if we're currently skipping lines (continuation of multi-line header)
    if (skipNextLines) {
      // Multi-line headers continue with whitespace (space or tab)
      if (line.startsWith(' ') || line.startsWith('\t')) {
        continue; // Skip this continuation line
      } else {
        // This line doesn't start with whitespace, so the multi-line header has ended
        skipNextLines = false;
        filteredLines.push(line);
      }
    } else {
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n');
}

/**
 * Extracts date from raw email content
 * @param {string} rawEmail - Raw email content
 * @returns {string|null} - ISO date string or null if not found
 */
export function extractDateFromRaw(rawEmail) {
  const dateMatch = rawEmail.match(/Date: (.*)/);
  if (dateMatch && dateMatch[1]) {
    try {
      const date = new Date(dateMatch[1]);
      return date.toISOString();
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Parses raw email content into headers and body.
 * @param {string} rawEmail - Full raw email content (headers + body)
 * @returns {{headers: Record<string, string>, body: string}} - Object containing parsed headers and body
 */
export function parseEmail(rawEmail) {
  const headerEndIndex = rawEmail.search(/\r?\n\r?\n/);
  if (headerEndIndex === -1) return {headers: {}, body: rawEmail};

  const headerText = rawEmail.slice(0, headerEndIndex);
  const body = rawEmail.slice(headerEndIndex + 2).trim();
  const lines = headerText.split(/\r?\n/);
  const headers = {};
  let currentKey = null;

  for (const line of lines) {
    if (/^\s/.test(line) && currentKey) {
      headers[currentKey] += ' ' + line.trim();
    } else {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        currentKey = match[1].toLowerCase();
        headers[currentKey] = match[2];
      }
    }
  }

  return {headers, body};
}

/**
 * Parses SpamAssassin output to extract spam information
 * @returns {Object} - Object containing spam information
 * @param headers
 */
export function parseSpamAssassinOutput(headers) {
  const scoreMatch = headers['x-spam-status']?.match(/score=([0-9.-]+)/);
  const requiredMatch = headers['x-spam-status']?.match(/required=([0-9.-]+)/);
  const levelMatch = headers['x-spam-level'];
  const spamFlagMatch = headers['x-spam-flag'];

  const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;
  const required = requiredMatch ? parseFloat(requiredMatch[1]) : null;
  const level = levelMatch ? levelMatch.length : 0;
  const isSpam = spamFlagMatch === 'YES';

  return {
    score,
    required,
    level,
    isSpam,
  };
}

