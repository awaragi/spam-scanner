import { findFirstUIDOnDate } from './lib/imap-client.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 <folder> [--since date] [--write]')
  .option('since', { type: 'string', describe: 'ISO date' })
  .option('write', { type: 'boolean', default: false })
  .demandCommand(1)
  .argv;

const folder = argv._[0];
const since = argv.since;
const write = argv.write;

const result = await findFirstUIDOnDate(folder, since, write);
console.log(JSON.stringify(result, null, 2));