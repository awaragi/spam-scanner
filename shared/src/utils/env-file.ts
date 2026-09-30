/**
 * Local structural shape for a described/defaulted Zod field - not imported
 * from `core/config.ts` (utils must never import types from core) and not
 * zod's own internal types (this only needs the two properties it actually
 * reads).
 */
interface DescribedField {
  description?: string;
  _def: { type: string; defaultValue?: unknown };
}

interface TitledSchemaGroup {
  title: string;
  schema: { shape: Record<string, DescribedField> };
}

interface SchemaGroup {
  schema: { shape: Record<string, DescribedField> };
}

export interface RenderEnvFileOptions {
  /** Only emit keys whose value differs from the schema default. */
  skipDefaults?: boolean;
  /** Omit group titles and per-key description comments. */
  skipComments?: boolean;
}

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
 * @param groups
 * @param [values]
 * Keys in `values` unknown to `groups` are appended in a trailing section.
 * @param [options] `skipDefaults` / `skipComments` trim the output; groups left
 * with no keys are dropped entirely under `skipDefaults`.
 * @returns the full file content, ending in a single trailing newline
 */
export function renderEnvFile(
  groups: TitledSchemaGroup[],
  values: Record<string, string> = {},
  options: RenderEnvFileOptions = {},
): string {
  const { skipDefaults = false, skipComments = false } = options;
  const lines: string[] = [];
  let firstGroup = true;
  for (const group of groups) {
    const groupLines: string[] = [];
    for (const [key, field] of Object.entries(group.schema.shape)) {
      const defaultValue = fieldDefault(field);
      const value = Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : defaultValue;
      if (skipDefaults && value === defaultValue) {
        continue;
      }
      if (!skipComments && field.description) {
        for (const commentLine of field.description.split('\n')) {
          groupLines.push(commentLine.length > 0 ? `# ${commentLine}` : '#');
        }
      }
      groupLines.push(`${key}=${value}`);
    }
    if (skipDefaults && groupLines.length === 0) {
      continue;
    }
    if (!firstGroup) {
      lines.push('');
    }
    firstGroup = false;
    if (!skipComments) {
      lines.push(`# ${group.title}`);
    }
    lines.push(...groupLines);
  }

  // Keys in `values` the schema doesn't know (e.g. docker-compose-only
  // variables like SPAM_SCANNER_DATA) are copied through verbatim so a
  // migration never drops them; they are never validated.
  const knownKeys = new Set(
    groups.flatMap((group) => Object.keys(group.schema.shape)),
  );
  const extraKeys = Object.keys(values).filter((key) => !knownKeys.has(key));
  if (extraKeys.length > 0) {
    if (lines.length > 0) {
      lines.push('');
    }
    if (!skipComments) {
      lines.push('# Other (not part of the server config, kept as-is)');
    }
    extraKeys.forEach((key) => lines.push(`${key}=${values[key]}`));
  }

  if (lines.length === 0) {
    return '';
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Compares an existing env file's parsed `values` (e.g. via `dotenv.parse()`)
 * against `groups`' known keys - used to report, after a `renderEnvFile`
 * migration, which keys fell back to their default (worth reviewing) and
 * which keys in `values` don't match any known config variable (e.g.
 * renamed or removed since the file was last generated).
 * @param groups
 * @param values
 */
export function diffEnvValues(
  groups: SchemaGroup[],
  values: Record<string, string>,
): { defaultedKeys: string[]; unknownKeys: string[] } {
  const knownKeys = groups.flatMap((group) => Object.keys(group.schema.shape));
  const knownKeySet = new Set(knownKeys);
  const defaultedKeys = knownKeys.filter(
    (key) => !Object.prototype.hasOwnProperty.call(values, key),
  );
  const unknownKeys = Object.keys(values).filter(
    (key) => !knownKeySet.has(key),
  );
  return { defaultedKeys, unknownKeys };
}

/**
 * A field's `.default()` value as a string, or '' when it has none (e.g.
 * `.optional()` fields like `IMAP_HOST` with no safe default).
 * @param field
 */
function fieldDefault(field: DescribedField): string {
  const raw = field._def.defaultValue;
  return raw === undefined ? '' : String(raw);
}
