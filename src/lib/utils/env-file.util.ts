/**
 * Renders a dotenv-style file (e.g. `.env.example`) from an ordered array of
 * `{ title, schema }` groups, where `schema` is a Zod object whose fields
 * carry `.describe()` text and (optionally) a `.default()`. Pure function of
 * its input - no filesystem access, so it's usable both by
 * `src/cli/generate-env.js` and by a test asserting the committed
 * file matches what the schema would produce.
 *
 * `values`, when given, overrides a key's rendered value with
 * `values[key]` whenever that key is present (own property) in `values` -
 * used by `generate-env.js`'s `--input` flag to migrate an existing
 * env file onto the current structure/headers/comments while preserving
 * whatever it already sets. A key absent from `values` still falls back to
 * its schema default, same as when `values` is omitted entirely.
 * @param {Array<{title: string, schema: import('zod').ZodObject}>} groups
 * @param {Record<string, string>} [values]
 * @returns {string} the full file content, ending in a single trailing newline
 */
export function renderEnvFile(groups, values = {}) {
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
      const value = Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : fieldDefault(field);
      lines.push(`${key}=${value}`);
    }
  });
  lines.push('');
  return lines.join('\n');
}

/**
 * Compares an existing env file's parsed `values` (e.g. via `dotenv.parse()`)
 * against `groups`' known keys - used to report, after a `renderEnvFile`
 * migration, which keys fell back to their default (worth reviewing) and
 * which keys in `values` don't match any known config variable (e.g.
 * renamed or removed since the file was last generated).
 * @param {Array<{schema: import('zod').ZodObject}>} groups
 * @param {Record<string, string>} values
 * @returns {{defaultedKeys: string[], unknownKeys: string[]}}
 */
export function diffEnvValues(groups, values) {
  const knownKeys = groups.flatMap(group => Object.keys(group.schema.shape));
  const knownKeySet = new Set(knownKeys);
  const defaultedKeys = knownKeys.filter(
    key => !Object.prototype.hasOwnProperty.call(values, key)
  );
  const unknownKeys = Object.keys(values).filter(key => !knownKeySet.has(key));
  return { defaultedKeys, unknownKeys };
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
