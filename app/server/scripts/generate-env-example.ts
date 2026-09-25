import { writeFileSync } from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { pathToFileURL } from 'url';
import { configGroups } from '../src/config/app-config.schema.ts';
import { renderEnvFile } from '../src/domain/utils/env-file.ts';

/**
 * Renders `app/server/.env.example` from `configGroups` (see
 * `app-config.schema.ts`) - the single source of truth for every key's
 * default and documentation. Run after changing `configGroups` instead of
 * hand-editing the example file, so the two can't drift (see the drift test
 * in `app-config.schema.env-example.spec.ts`).
 *
 * Invoked directly via `node` (Node 24's built-in TypeScript support), the
 * same way `terminal/src/cli/generate-env.ts` is - see design.md D10 and
 * `package.json`'s `generate:env-example` script.
 */
export function generateEnvExample(outputPath: string): void {
  writeFileSync(outputPath, renderEnvFile(configGroups));
  console.log(`Wrote ${outputPath}`);
}

const isMainModule =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const argv = await yargs(hideBin(process.argv))
    .usage('Usage: $0 [--output <path>]')
    .option('output', {
      type: 'string',
      default: '.env.example',
      describe:
        'Path to write the rendered example environment file to, relative to the current working directory.',
    })
    .strict()
    .help().argv;

  generateEnvExample(argv.output);
}
