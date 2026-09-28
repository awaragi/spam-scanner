/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import dts from 'vite-plugin-dts';

// One Vite library entry per top-level `src/` subfolder (design.md D2), so
// each ends up importable as its own `exports` subpath (`shared/ai`,
// `shared/utils`, ...) instead of one combined barrel.
const entries = ['ai', 'classification', 'scanning', 'sender-lists', 'state', 'utils'];

export default defineConfig({
  plugins: [
    // Matches tsconfig.build.json's exclude on the server side: spec files
    // are never part of the shipped declaration output.
    dts({ entryRoot: 'src', outDir: 'dist', include: ['src'], exclude: ['src/**/*.spec.ts'] }),
  ],
  build: {
    outDir: 'dist',
    lib: {
      entry: Object.fromEntries(
        entries.map((name) => [
          `${name}/index`,
          new URL(`src/${name}/index.ts`, import.meta.url).pathname,
        ]),
      ),
      formats: ['es'],
    },
    rollupOptions: {
      // Runtime npm dependencies (mailparser, openai, email-addresses) stay
      // external rather than bundled - consumers resolve them the normal
      // node_modules way, same as any other package.
      external: (id) => !id.startsWith('.') && !id.startsWith('/'),
      output: {
        // Subfolders cross-import each other (e.g. classification ->
        // sender-lists); preserveModules keeps that a relative import in the
        // output instead of duplicating code across entry bundles.
        preserveModules: true,
        preserveModulesRoot: 'src',
        entryFileNames: '[name].js',
      },
    },
  },
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
  },
});
