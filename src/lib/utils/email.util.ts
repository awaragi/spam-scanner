/**
 * Simple helper to safely convert date to string
 * @param {any} date - Date value to convert
 * @returns {string} - ISO string or empty string if conversion fails
 */
export function dateToString(date: unknown): string {
  try {
    return date ? (date as Date).toISOString() : '';
  } catch {
    return '';
  }
}
