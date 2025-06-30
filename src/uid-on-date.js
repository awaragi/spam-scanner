import {findFirstUIDOnDate, newClient} from './lib/imap-client.js';
import yargs from 'yargs';
import {hideBin} from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 <folder> [--since YYYY-MM-DD]')
    .option('since', {
      type: 'string',
      default: '1970-01-01'
    })
    .demandCommand(1).argv;

const [folder] = argv._;
const imap = newClient();

try {
  await imap.connect();
  const result = await findFirstUIDOnDate(imap, folder, argv.since);

  if (result) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(null);
  }
} finally {
  await imap.logout();
}
