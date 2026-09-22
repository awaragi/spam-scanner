/**
 * Renders a dotenv-style file (e.g. `.env.example`) from an ordered array of
 * `{ title, schema }` groups, where `schema` is a Zod object whose fields
 * carry `.describe()` text and (optionally) a `.default()`. Pure function of
 * its input - no filesystem access, so it's usable both by
 * `src/cli/generate-env-example.js` and by a test asserting the committed
 * file matches what the schema would produce.
 * @param {Array<{title: string, schema: import('zod').ZodObject}>} groups
 * @returns {string} the full file content, ending in a single trailing newline
 */
export function renderEnvFile(groups) {
  const lines = [];
  groups.forEach((group, index) => {
    if (index > 0) {
      lines.push('');
    }
    lines.push(`# ${group.title}`);
    for (const [key, field] of Object.entries(group.schema.shape)) {
      if (field.description) {
        for (const commentLine of field.description.split('\n')) {
          lines.push(commentLine.length > 0 ? `# ${commentLine}` : '#');
        }
      }
      lines.push(`${key}=${fieldDefault(field)}`);
    }
  });
  lines.push('');
  return lines.join('\n');
}

/**
 * A field's `.default()` value as a string, or '' when it has none (e.g.
 * `.optional()` fields like `IMAP_HOST` with no safe default).
 * @param {import('zod').ZodTypeAny} field
 * @returns {string}
 */
function fieldDefault(field) {
  const raw = field._def.defaultValue;
  return raw === undefined ? '' : String(raw);
}
