/**
 * Generic text formatting/truncation helpers, no domain knowledge.
 */

// Rough, dependency-free heuristic for English text; used only to bound cost, not for exact billing.
const CHARS_PER_TOKEN = 4;

interface Addressed {
  name?: string;
  address?: string;
}

/**
 * Formats an ImapFlow envelope address list as "Name <addr>, Name2 <addr2>".
 * @param {Array<{name?: string, address?: string}>} [addresses]
 * @returns {string}
 */
export function formatAddressList(addresses: unknown = []): string {
  if (!Array.isArray(addresses)) return '';
  return (addresses as Addressed[])
    .map(({ name, address }) => (name ? `${name} <${address}>` : address))
    .filter(Boolean)
    .join(', ');
}

/**
 * Truncates text to a token budget using a chars-per-token heuristic.
 * @param {string} text
 * @param {number} maxTokens
 * @returns {string}
 */
export function truncateToTokenBudget(
  text: string | undefined,
  maxTokens: number
): string {
  if (!text) return '';
  const maxChars = Math.max(0, maxTokens) * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[truncated]`;
}
