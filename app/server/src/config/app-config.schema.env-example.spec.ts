import { describe, test, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { configGroups } from './app-config.schema.js';
import { renderEnvFile } from '../domain/utils/env-file.js';

/**
 * Guards against exactly the drift `bin/generate-env.ts` exists to
 * prevent: a `configGroups` default/description changing without
 * regenerating the committed `app/server/.env.example` (see the
 * `server/configuration` spec's "example environment file is generated from
 * the schema and kept in sync" requirement, and design.md D10).
 */
describe('configGroups -> .env.example sync', () => {
  test('the committed .env.example matches what configGroups renders', () => {
    const serverRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../..',
    );
    const committed = readFileSync(resolve(serverRoot, '.env.example'), 'utf8');

    expect(committed).toBe(renderEnvFile(configGroups));
  });
});
