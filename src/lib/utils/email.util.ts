/**
 * Simple helper to safely convert date to string
 * @param {any} date - Date value to convert
 * @returns {string} - ISO string or empty string if conversion fails
 */
export function dateToString(date) {
  try {
    return date ? date.toISOString() : '';
  } catch {
    return '';
  }
}
