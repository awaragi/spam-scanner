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
    if (
      lowerLine.startsWith('x-spam-') ||
      lowerLine.startsWith('x-ham-report')
    ) {
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
  if (headerEndIndex === -1) return { headers: {}, body: rawEmail };

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

  return { headers, body };
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

/**
 * Parses Rspamd JSON response to extract spam information
 * @param {Object} response - JSON response object from Rspamd /checkv2 endpoint
 * @returns {Object} - Object containing spam information
 */
export function parseRspamdOutput(response) {
  if (!response || typeof response !== 'object') {
    const err = new Error('Invalid Rspamd response format');
    err.permanent = true;
    throw err;
  }

  const score = response.score || 0;
  const required = response.required_score || 0;

  // Map Rspamd actions to isSpam boolean
  // "reject" and "add header" are spam actions
  // "no action", "greylist" are non-spam actions
  const action = response.action || 'no action';
  // Only "reject" action means definite spam
  // "add header" means suspicious but below spam threshold
  const isSpam = action === 'reject';

  // WHITELIST_EMAIL fires when the sender matches whitelist.map (see
  // rspamd/config/multimap.conf) - a deliberate, human-curated trust decision.
  const isWhitelisted = Boolean(
    response.symbols && response.symbols.WHITELIST_EMAIL
  );

  return {
    score,
    required,
    level: null,
    isSpam,
    isWhitelisted,
  };
}

/**
 * Parses an AI chat-completion's text content into a spam classification.
 * Tolerates markdown code fences (```json ... ``` or ``` ... ```) around the JSON.
 * @param {string} content - Raw text content from the AI response
 * @returns {{score: number, reasoning: string}} - Object containing spam classification
 * @throws {Error} - If content is empty, not valid JSON, or missing a numeric score
 */
export function parseAiClassificationOutput(content) {
  if (!content || typeof content !== 'string') {
    throw new Error('AI response content is empty');
  }

  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = (fenceMatch ? fenceMatch[1] : content).trim();

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`AI response is not valid JSON: ${err.message}`);
  }

  if (typeof parsed.score !== 'number' || Number.isNaN(parsed.score)) {
    throw new Error(`AI response missing numeric "score" field: ${jsonText}`);
  }

  const score = Math.min(Math.max(parsed.score, 0), 100);
  const reasoning =
    typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';

  return { score, reasoning };
}
