import { readFileSync, writeFileSync } from 'fs';
import { parse as parseEnvFile } from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { pathToFileURL } from 'url';
import { configGroups } from '../server/src/config/app-config.schema.ts';
import { diffEnvValues, renderEnvFile } from 'shared/utils';

/**
 * Renders an env file from `configGroups` (see `app-config.schema.ts`) - the
 * single source of truth for every key's default and documentation.
 *
 * With no `inputPath`, this renders `server/.env.example`: run it after
 * changing `configGroups` instead of hand-editing the example file, so the
 * two can't drift (see the drift test in
 * `app-config.schema.env-example.spec.ts`).
 *
 * With `inputPath`, it migrates an existing server env file (e.g. a `.env`
 * from before a schema change) onto the current structure/headers/comments:
 * any key the input already sets keeps its value, everything else falls back
 * to its schema default.
 *
 * Invoked directly via `node` (Node 24's built-in TypeScript support) - see
 * design.md D10 and `package.json`'s `generate:env`/`generate:env-example`
 * scripts. The reach into `../server/src/config/...` by relative path
 * (rather than through a `shared`-style package export) is a deliberate,
 * narrow exception - see this change's design.md D3.
 */
export function generateEnv(outputPath: string, inputPath?: string): void {
  const values = inputPath
    ? parseEnvFile(readFileSync(inputPath, 'utf-8'))
    : {};

  writeFileSync(outputPath, renderEnvFile(configGroups, values));
  console.log(`Wrote ${outputPath}`);

  if (!inputPath) {
    return;
  }

  // Key names only - never print a value read from the input file.
  const { defaultedKeys, unknownKeys } = diffEnvValues(configGroups, values);
  if (defaultedKeys.length > 0) {
    console.log(
      `\nNot set in ${inputPath} - fell back to default (review and adjust manually if needed):`,
    );
    defaultedKeys.forEach((key) => console.log(`  - ${key}`));
  }
  if (unknownKeys.length > 0) {
    console.log(
      `\nIn ${inputPath} but not a known config variable (possibly renamed or removed):`,
    );
    unknownKeys.forEach((key) => console.log(`  - ${key}`));
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const argv = await yargs(hideBin(process.argv))
    .usage('Usage: $0 --output <path> [--input <path>]')
    .option('input', {
      type: 'string',
      describe:
        'Existing server env file to migrate onto the current structure - its values are kept in place of defaults for any key it already sets.',
    })
    .option('output', {
      type: 'string',
      demandOption: true,
      describe:
        'Path to write the rendered env file to, relative to the current working directory.',
    })
    .strict()
    .help().argv;

  generateEnv(argv.output, argv.input);
}
