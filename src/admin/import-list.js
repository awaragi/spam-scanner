import fs from 'fs/promises';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { newClient, safeLogout } from '../lib/clients/imap.client.js';
import { config } from '../lib/core/config.js';
import { rootLogger } from '../lib/core/logger.js';
import { updateListState } from '../lib/controllers/steps/list-update.step.js';
import { parseAddressList } from '../lib/services/sender-lists.service.js';

// Migration/restore tool (see the `sender-lists` capability): loads a local
// file - a legacy rspamd map file, or a JSON export from `export-list.js` -
// into the mailbox's IMAP-backed whitelist/blacklist. The source file is a
// plain CLI argument, not derived from any config/env map path or Docker
// mount - the app no longer has either.

const logger = rootLogger.forComponent('import-list');

const argv = yargs(hideBin(process.argv))
  .usage(
    'Usage: $0 --list <whitelist|blacklist> --file <path> [--mode append|override] [--format txt|json]'
  )
  .option('list', {
    type: 'string',
    choices: ['whitelist', 'blacklist'],
    demandOption: true,
    describe: 'Which mailbox-backed list to import into',
  })
  .option('file', {
    type: 'string',
    demandOption: true,
    describe:
      'Path to a local file (one address per line, or a JSON array with --format json) to import',
  })
  .option('mode', {
    type: 'string',
    choices: ['append', 'override'],
    default: 'append',
    describe:
      'append merges with existing IMAP-backed entries; override replaces them entirely',
  })
  .option('format', {
    type: 'string',
    choices: ['txt', 'json'],
    default: 'txt',
    describe:
      'txt = one address per line (legacy map format); json = a JSON array of addresses',
  })
  .strict()
  .help().argv;

const mapStateKey =
  argv.list === 'whitelist'
    ? config.STATE_KEY_WHITELIST_MAP
    : config.STATE_KEY_BLACKLIST_MAP;

const imap = newClient();

try {
  const raw = await fs.readFile(argv.file, 'utf-8');
  const addresses = parseAddressList(raw, argv.format);

  await imap.connect();
  const result = await updateListState(imap, mapStateKey, addresses, argv.mode);

  const summary = {
    list: argv.list,
    mode: argv.mode,
    format: argv.format,
    file: argv.file,
    sourceCount: addresses.length,
    ...result,
  };
  logger.info(summary, 'Import complete');
  console.log(JSON.stringify(summary, null, 2));
} catch (err) {
  logger.error({ error: err.message }, 'Import failed');
  process.exitCode = 1;
} finally {
  await safeLogout(imap);
}
