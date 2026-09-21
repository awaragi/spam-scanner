import fs from 'fs/promises';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { newClient, safeLogout } from '../lib/clients/imap.client.js';
import { rootLogger } from '../lib/core/logger.js';
import {
  readScannerState,
  readMapState,
} from '../lib/clients/state-manager.client.js';
import { config } from '../lib/core/config.js';

// Full mailbox state backup/migration tool (see the `sender-lists`
// capability): bundles scanner state, whitelist, and blacklist into one
// JSON file, so all three can move together - a full backup, or a move to
// a different mailbox/account. For a single list only, use
// `export-list.js`; for scanner state only, `read-state.js`.

const logger = rootLogger.forComponent('export-mailbox-state');

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 [--file <path>]')
  .option('file', {
    type: 'string',
    describe: 'Path to write the bundle to. Omit to print to standard output.',
  })
  .strict()
  .help().argv;

const imap = newClient();

try {
  await imap.connect();

  // Sequential, not Promise.all: each read switches the connection's
  // selected mailbox and restores it afterward, which isn't safe to run
  // concurrently on a single IMAP connection (see scan-workflow.js).
  const scannerState = await readScannerState(imap);
  const whitelist = await readMapState(imap, config.STATE_KEY_WHITELIST_MAP);
  const blacklist = await readMapState(imap, config.STATE_KEY_BLACKLIST_MAP);

  const bundle = { scannerState, whitelist, blacklist };
  const output = JSON.stringify(bundle, null, 2);

  if (argv.file) {
    await fs.writeFile(argv.file, output, 'utf-8');
    logger.info(
      {
        file: argv.file,
        whitelistCount: whitelist.length,
        blacklistCount: blacklist.length,
      },
      'Export complete'
    );
  } else {
    process.stdout.write(output + '\n');
    logger.info(
      { whitelistCount: whitelist.length, blacklistCount: blacklist.length },
      'Export complete'
    );
  }
} catch (err) {
  logger.error({ error: err.message }, 'Export failed');
  process.exitCode = 1;
} finally {
  await safeLogout(imap);
}
