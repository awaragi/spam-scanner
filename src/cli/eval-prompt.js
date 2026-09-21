import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runPromptEval } from '../lib/controllers/workflows/prompt-eval.controller.js';
import { rootLogger } from '../lib/core/logger.js';

// Offline AI-prompt evaluation (see the `ai-prompt-eval` capability): scores a
// labeled `.eml` dataset with the current production prompt/config and writes
// a timestamped report. No IMAP connection is used, so this doesn't follow
// the newClient()/connect()/safeLogout() CLI pattern the IMAP-touching
// scripts in this folder use (see design.md).

const logger = rootLogger.forComponent('eval-prompt');

// Single source of truth for the bucket names this CLI knows about - the
// option registration, the "at least one" check, and the bucketPaths lookup
// below all derive from this instead of repeating the three names.
const BUCKET_DESCRIPTIONS = {
  ham: 'Folder of legitimate-mail .eml files to score',
  marketing:
    'Folder of subscribed-marketing .eml files to score (mail the user is legitimately subscribed to)',
  spam: 'Folder of phishing/spam .eml files to score',
};
const BUCKET_NAMES = Object.keys(BUCKET_DESCRIPTIONS);

let parser = yargs(hideBin(process.argv))
  .usage(
    `Usage: $0 --reports <folder> ${BUCKET_NAMES.map(name => `[--${name} <folder>]`).join(' ')}`
  )
  .option('reports', {
    type: 'string',
    demandOption: true,
    describe: 'Folder to write the timestamped report file to',
  });
for (const [name, describe] of Object.entries(BUCKET_DESCRIPTIONS)) {
  parser = parser.option(name, { type: 'string', describe });
}

const argv = parser
  .check(argv => {
    if (!BUCKET_NAMES.some(name => argv[name])) {
      throw new Error(
        `At least one of ${BUCKET_NAMES.map(name => `--${name}`).join(', ')} must be given`
      );
    }
    return true;
  })
  .strict()
  .help().argv;

const bucketPaths = Object.fromEntries(
  BUCKET_NAMES.map(name => [name, argv[name]]).filter(
    ([, folder]) => folder != null
  )
);

try {
  const { reportPath, bucketCounts } = await runPromptEval({
    bucketPaths,
    reportsDir: argv.reports,
  });
  logger.info({ reportPath, bucketCounts }, 'Prompt eval complete');
  process.stdout.write(`${reportPath}\n`);
} catch (err) {
  logger.error({ error: err.message }, 'Prompt eval failed');
  process.exitCode = 1;
}
