/**
 * Utility functions for parsing and processing email content
 */
import {mimeWordDecode} from 'emailjs-mime-codec';

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
 * Parses SpamAssassin output to extract spam information
 * @param {string} spamcOutput - Output from SpamAssassin check
 * @returns {Object} - Object containing spam information
 */
export function parseSpamAssassinOutput(spamcOutput) {
  const subjectMatch = spamcOutput.match(/^Subject:\s+(.*)$/m);
  const scoreMatch = spamcOutput.match(/X-Spam-Status:.*score=([0-9.-]+)/);
  const levelMatch = spamcOutput.match(/X-Spam-Level:\s+(\*+)/);
  const spamFlagMatch = spamcOutput.match(/X-Spam-Flag:\s+(\w+)/);

  const score = scoreMatch ? parseFloat(scoreMatch[1]) : null;
  const level = levelMatch ? levelMatch[1].length : 0;
  const isSpam = !!spamFlagMatch && spamFlagMatch[1] === 'YES';
  const subject = subjectMatch ? mimeWordDecode(subjectMatch[1].trim()) : '';

  return {
    score,
    level,
    isSpam,
    subject
  };
}