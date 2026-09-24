import { writeFileSync, readFileSync } from 'fs';
import { parse as parseEnvFile } from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { configGroups } from '../lib/core/config.ts';
import { renderEnvFile, diffEnvValues } from '../lib/utils/env-file.util.ts';

// Renders an env file from ConfigSchema's own groups/defaults/describe()
// text (see config.ts's module doc comment). Run with no `--input` after
// changing config.js to regenerate .env.example instead of hand-editing it,
// so the two can't drift (see package.json's `generate:env` script).
//
// `--input` repurposes the same rendering to migrate an existing env file
// (e.g. a local .env from before a config.js rename/restructure) onto the
// current structure/headers/comments: any key the input file already sets
// is kept as-is, everything else falls back to its schema default.
const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 --output <path> [--input <path>]')
  .option('input', {
    type: 'string',
    describe:
      'Existing .env-style file to migrate onto the current structure - ' +
      'its values are kept in place of defaults for any key it already sets.',
  })
  .option('output', {
    type: 'string',
    demandOption: true,
    describe: 'Path to write the result to.',
  })
  .strict()
  .help().argv;

const values = argv.input
  ? parseEnvFile(readFileSync(argv.input, 'utf-8'))
  : {};

writeFileSync(argv.output, renderEnvFile(configGroups, values));
console.log(`Wrote ${argv.output}`);

if (argv.input) {
  const { defaultedKeys, unknownKeys } = diffEnvValues(configGroups, values);

  if (defaultedKeys.length > 0) {
    console.log(
      `\nNot set in ${argv.input} - fell back to default (review and adjust manually if needed):`
    );
    defaultedKeys.forEach(key => console.log(`  - ${key}`));
  }

  if (unknownKeys.length > 0) {
    console.log(
      `\nIn ${argv.input} but not a known config variable (possibly renamed or removed):`
    );
    unknownKeys.forEach(key => console.log(`  - ${key}`));
  }
}
