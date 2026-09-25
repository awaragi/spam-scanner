/** Parse export/import text: JSON array or one address per line. */
export function parseAddressList(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith('[')) {
    const parsed: unknown = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('JSON must be an array of strings');
    }
    return parsed.map(String).map((s) => s.trim()).filter(Boolean);
  }
  return trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
