import fs from 'fs/promises';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { newClient, safeLogout } from '../lib/clients/imap.client.js';
import { config, assertRequiredConfig } from '../lib/core/config.js';
import { rootLogger } from '../lib/core/logger.js';
import { readMapState } from '../lib/clients/state-manager.client.js';
import { serializeAddressList } from '../lib/services/sender-lists.service.js';

// Backup/migration tool (see the `sender-lists` capability): dumps a
// mailbox's IMAP-backed whitelist/blacklist as `txt` (legacy map format) or
// `json` (round-trips through `import-list.js --format json`, and doubles
// as a byte-for-byte backup of the raw list state).

assertRequiredConfig();

const logger = rootLogger.forComponent('export-list');

const argv = yargs(hideBin(process.argv))
  .usage(
    'Usage: $0 --list <whitelist|blacklist> [--format txt|json] [--file <path>]'
  )
  .option('list', {
    type: 'string',
    choices: ['whitelist', 'blacklist'],
    demandOption: true,
    describe: 'Which mailbox-backed list to export',
  })
  .option('format', {
    type: 'string',
    choices: ['txt', 'json'],
    default: 'txt',
    describe:
      'txt = one address per line (legacy map format); json = a JSON array of addresses',
  })
  .option('file', {
    type: 'string',
    describe: 'Path to write the export to. Omit to print to standard output.',
  })
  .strict()
  .help().argv;

const mapStateKey =
  argv.list === 'whitelist'
    ? config.STATE_KEY_WHITELIST_MAP
    : config.STATE_KEY_BLACKLIST_MAP;

const imap = newClient();

try {
  await imap.connect();
  const addresses = await readMapState(imap, mapStateKey);
  const output = serializeAddressList(addresses, argv.format);

  if (argv.file) {
    await fs.writeFile(argv.file, output, 'utf-8');
    logger.info(
      {
        list: argv.list,
        format: argv.format,
        file: argv.file,
        count: addresses.length,
      },
      'Export complete'
    );
  } else {
    process.stdout.write(output);
    logger.info(
      { list: argv.list, format: argv.format, count: addresses.length },
      'Export complete'
    );
  }
} catch (err) {
  logger.error({ error: err.message }, 'Export failed');
  process.exitCode = 1;
} finally {
  await safeLogout(imap);
}
