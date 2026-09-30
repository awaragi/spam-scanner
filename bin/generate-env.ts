import { readFileSync, writeFileSync } from 'fs';
import { parse as parseEnvFile } from 'dotenv';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { pathToFileURL } from 'url';
import { configGroups } from '../server/src/config/app-config.schema.ts';
import {
  diffEnvValues,
  renderEnvFile,
  type RenderEnvFileOptions,
} from 'shared/utils';

/**
 * Renders an env file from `configGroups` (see `app-config.schema.ts`) - the
 * single source of truth for every key's default and documentation.
 *
 * With no `inputPath`, this renders the repo-root `.env.example`: run it after
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
export interface GenerateEnvOptions extends RenderEnvFileOptions {
  outputPath?: string;
  inputPath?: string;
}

export function generateEnv({
  outputPath,
  inputPath,
  ...renderOptions
}: GenerateEnvOptions = {}): void {
  const values = inputPath
    ? parseEnvFile(readFileSync(inputPath, 'utf-8'))
    : {};
  const rendered = renderEnvFile(configGroups, values, renderOptions);

  // With no output path the env content goes to stdout, so every status
  // message below goes to stderr to keep stdout pipeable.
  let log = console.error;
  if (outputPath) {
    writeFileSync(outputPath, rendered);
    log = console.log;
    log(`Wrote ${outputPath}`);
  } else {
    process.stdout.write(rendered);
  }

  if (!inputPath) {
    return;
  }

  // Key names only - never print a value read from the input file.
  const { defaultedKeys, unknownKeys } = diffEnvValues(configGroups, values);
  if (defaultedKeys.length > 0) {
    log(
      `\nNot set in ${inputPath} - fell back to default (review and adjust manually if needed):`,
    );
    defaultedKeys.forEach((key) => log(`  - ${key}`));
  }
  if (unknownKeys.length > 0) {
    log(
      `\nIn ${inputPath} but not a known config variable - copied through unchanged, not validated (e.g. docker-compose-only keys; otherwise possibly renamed or removed):`,
    );
    unknownKeys.forEach((key) => log(`  - ${key}`));
  }
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const argv = await yargs(hideBin(process.argv))
    .usage(
      'Usage: $0 [--output <path>] [--input <path>] [--skip-defaults] [--skip-comments]',
    )
    .option('input', {
      type: 'string',
      describe:
        'Existing server env file to migrate onto the current structure - its values are kept in place of defaults for any key it already sets.',
    })
    .option('output', {
      type: 'string',
      describe:
        'Path to write the rendered env file to, relative to the current working directory. When omitted, the result is printed to the console.',
    })
    .option('skip-defaults', {
      type: 'boolean',
      default: false,
      describe: 'Only output the values that differ from the schema defaults.',
    })
    .option('skip-comments', {
      type: 'boolean',
      default: false,
      describe: 'Omit group titles and variable descriptions.',
    })
    .strict()
    .help().argv;

  generateEnv({
    outputPath: argv.output,
    inputPath: argv.input,
    skipDefaults: argv['skip-defaults'],
    skipComments: argv['skip-comments'],
  });
}
