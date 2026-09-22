import { writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { configGroups } from '../lib/core/config.js';
import { renderEnvFile } from '../lib/utils/env-file.util.js';

// Regenerates .env.example from ConfigSchema's own groups/defaults/describe()
// text (see config.js's module doc comment) - run this after changing
// config.js instead of hand-editing .env.example, so the two can't drift.
const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../../.env.example');

writeFileSync(outPath, renderEnvFile(configGroups));

console.log(`Wrote ${outPath}`);
