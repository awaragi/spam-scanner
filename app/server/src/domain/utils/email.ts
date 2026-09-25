/**
 * Simple helper to safely convert date to string
 * @param date - Date value to convert
 * @returns - ISO string or empty string if conversion fails
 */
export function dateToString(date: unknown): string {
  try {
    return date ? (date as Date).toISOString() : '';
  } catch {
    return '';
  }
}
