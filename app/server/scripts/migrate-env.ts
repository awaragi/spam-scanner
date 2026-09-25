import { readFileSync, writeFileSync } from 'fs';
import { parse as parseEnvFile } from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { pathToFileURL } from 'url';
import { configGroups } from '../src/config/app-config.schema.ts';
import { renderEnvFile } from '../src/domain/utils/env-file.ts';

/**
 * Maps a source (terminal-shaped) mailbox-connection key onto the server's
 * `MAILBOX_*` key, per the `server/configuration` spec's migration
 * requirement and design.md D10.
 */
const MAILBOX_KEY_MAP: Record<string, string> = {
  IMAP_HOST: 'MAILBOX_IMAP_HOST',
  IMAP_PORT: 'MAILBOX_IMAP_PORT',
  IMAP_USER: 'MAILBOX_IMAP_USER',
  IMAP_PASSWORD: 'MAILBOX_IMAP_PASSWORD',
  IMAP_TLS: 'MAILBOX_IMAP_TLS',
  IMAP_ALLOW_INSECURE: 'MAILBOX_IMAP_ALLOW_INSECURE',
  FOLDER_STATE: 'MAILBOX_STATE_FOLDER',
};

function looksLikeEmail(value: string | undefined): value is string {
  return typeof value === 'string' && value.includes('@');
}

export interface MigrateEnvResult {
  /** The full rendered destination file content. */
  content: string;
  /** App-setting keys the source file set, carried forward unchanged. */
  appSettingKeysCarried: string[];
  /** Server `MAILBOX_*` keys populated from a mapped source key. */
  mailboxKeysMapped: string[];
  /** Source keys that matched neither an app setting nor a mailbox-connection key - dropped silently. */
  droppedKeys: string[];
  /** Which source key `MAILBOX_ID` was derived from, or `null` if neither matched. */
  mailboxIdSource: 'IMAP_USER' | 'IMAP_NOTIFY_ADDRESS' | null;
}

/**
 * Pure transform from a source file's raw parsed key/value pairs to the
 * destination file's rendered content, plus the key-name/count bookkeeping
 * `migrateEnvFile` reports to the operator. Never inspects or returns a key's
 * value except by placing it, unlogged, into `content` - see the
 * `server/configuration` spec's "never surfaces a secret value" scenario.
 */
export function migrateEnvValues(
  source: Record<string, string>,
): MigrateEnvResult {
  // The `MAILBOX_` prefix is what design.md D5 uses to mark a key as mailbox-
  // connection info rather than an app setting - see app-config.schema.ts's
  // module doc comment.
  const allKeys = configGroups.flatMap((group) =>
    Object.keys(group.schema.shape),
  );
  const appSettingKeys = allKeys.filter((key) => !key.startsWith('MAILBOX_'));

  const values: Record<string, string> = {};

  const appSettingKeysCarried = appSettingKeys.filter((key) =>
    Object.prototype.hasOwnProperty.call(source, key),
  );
  for (const key of appSettingKeysCarried) {
    values[key] = source[key];
  }

  const mailboxKeysMapped: string[] = [];
  for (const [sourceKey, targetKey] of Object.entries(MAILBOX_KEY_MAP)) {
    if (Object.prototype.hasOwnProperty.call(source, sourceKey)) {
      values[targetKey] = source[sourceKey];
      mailboxKeysMapped.push(targetKey);
    }
  }

  let mailboxIdSource: 'IMAP_USER' | 'IMAP_NOTIFY_ADDRESS' | null = null;
  if (looksLikeEmail(source.IMAP_USER)) {
    values.MAILBOX_ID = source.IMAP_USER;
    mailboxIdSource = 'IMAP_USER';
  } else if (looksLikeEmail(source.IMAP_NOTIFY_ADDRESS)) {
    values.MAILBOX_ID = source.IMAP_NOTIFY_ADDRESS;
    mailboxIdSource = 'IMAP_NOTIFY_ADDRESS';
  }
  // Neither matched: MAILBOX_ID is left out of `values` entirely, so
  // `renderEnvFile` falls back to the schema's own default for it (there is
  // none, so it renders empty - see the "no email-shaped value available"
  // scenario in the `server/configuration` spec).

  const recognizedSourceKeys = new Set<string>([
    ...appSettingKeysCarried,
    ...Object.keys(MAILBOX_KEY_MAP).filter((key) =>
      Object.prototype.hasOwnProperty.call(source, key),
    ),
  ]);
  const droppedKeys = Object.keys(source).filter(
    (key) => !recognizedSourceKeys.has(key),
  );

  return {
    content: renderEnvFile(configGroups, values),
    appSettingKeysCarried,
    mailboxKeysMapped,
    droppedKeys,
    mailboxIdSource,
  };
}

/**
 * Migrates an existing single-mailbox environment file (terminal's shape)
 * onto the server's schema: reads `inputPath`, transforms it via
 * `migrateEnvValues`, and writes the result to `outputPath`.
 *
 * Never prints, logs, or otherwise surfaces the value of any key it reads or
 * writes, on success or failure - only key names and counts (see the
 * `server/configuration` spec's migration requirement).
 */
export function migrateEnvFile(inputPath: string, outputPath: string): void {
  const source = parseEnvFile(readFileSync(inputPath, 'utf-8'));
  const result = migrateEnvValues(source);

  writeFileSync(outputPath, result.content);

  if (!result.mailboxIdSource) {
    console.warn(
      'MAILBOX_ID could not be derived: neither IMAP_USER nor IMAP_NOTIFY_ADDRESS in the ' +
        'source file is shaped like an email address. MAILBOX_ID is left empty in the ' +
        'output - fill it in by hand.',
    );
  }

  console.log(
    `Wrote ${outputPath}: ${result.appSettingKeysCarried.length} app-setting key(s) carried forward, ` +
      `${result.mailboxKeysMapped.length} mailbox-connection key(s) mapped, ` +
      `${result.droppedKeys.length} key(s) dropped` +
      (result.mailboxIdSource
        ? `, MAILBOX_ID derived from ${result.mailboxIdSource}`
        : ', MAILBOX_ID left empty (see warning above)'),
  );
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const argv = await yargs(hideBin(process.argv))
    .usage('Usage: $0 --input <path> --output <path>')
    .option('input', {
      type: 'string',
      demandOption: true,
      describe:
        "Existing single-mailbox environment file to migrate (terminal's shape).",
    })
    .option('output', {
      type: 'string',
      demandOption: true,
      describe: 'Path to write the server-shaped environment file to.',
    })
    .strict()
    .help().argv;

  migrateEnvFile(argv.input, argv.output);
}
