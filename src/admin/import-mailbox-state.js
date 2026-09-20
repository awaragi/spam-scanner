import fs from 'fs/promises';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { newClient, safeLogout } from '../lib/clients/imap-client.js';
import { rootLogger } from '../lib/utils/logger.js';
import { writeScannerState } from '../lib/state-manager.js';
import { updateListState } from '../lib/services/map-service.js';
import { config } from '../lib/utils/config.js';

// Full mailbox state restore/migration tool (see the `sender-lists`
// capability): the reverse of `export-mailbox-state.js` - restores scanner
// state, whitelist, and blacklist from one bundle file, into this mailbox
// or a different one. Only the keys present in the file are restored, so a
// partial (e.g. lists-only) bundle is valid input.

const logger = rootLogger.forComponent('import-mailbox-state');

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 --file <path> [--mode append|override]')
  .option('file', {
    type: 'string',
    demandOption: true,
    describe: 'Path to a bundle file produced by export-mailbox-state.js',
  })
  .option('mode', {
    type: 'string',
    choices: ['append', 'override'],
    default: 'append',
    describe:
      'Applies to whitelist/blacklist only: append merges with existing IMAP-backed entries; override replaces them entirely. scannerState, if present, always fully replaces the destination scanner state.',
  })
  .strict()
  .help().argv;

const imap = newClient();

try {
  const raw = await fs.readFile(argv.file, 'utf-8');
  const bundle = JSON.parse(raw);

  await imap.connect();

  const restored = [];

  if (bundle.scannerState !== undefined) {
    await writeScannerState(imap, bundle.scannerState);
    restored.push('scannerState');
  }

  let whitelistResult = null;
  if (bundle.whitelist !== undefined) {
    whitelistResult = await updateListState(
      imap,
      config.STATE_KEY_WHITELIST_MAP,
      bundle.whitelist,
      argv.mode
    );
    restored.push('whitelist');
  }

  let blacklistResult = null;
  if (bundle.blacklist !== undefined) {
    blacklistResult = await updateListState(
      imap,
      config.STATE_KEY_BLACKLIST_MAP,
      bundle.blacklist,
      argv.mode
    );
    restored.push('blacklist');
  }

  const summary = {
    file: argv.file,
    mode: argv.mode,
    restored,
    whitelistTotal: whitelistResult?.total,
    blacklistTotal: blacklistResult?.total,
  };
  logger.info(summary, 'Import complete');
  console.log(JSON.stringify(summary, null, 2));
} catch (err) {
  logger.error({ error: err.message }, 'Import failed');
  process.exitCode = 1;
} finally {
  await safeLogout(imap);
}
