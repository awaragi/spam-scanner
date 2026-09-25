import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    // Resolves the path aliases declared in tsconfig.json, including the ones
    // added by `nest g library`.
    tsconfigPaths(),
    // Vitest's default esbuild transform strips decorators without emitting
    // decorator metadata, which breaks Nest's constructor-injection DI. Swap
    // in SWC for the test transform only; the build itself still uses tsc
    // (see nest-cli.json / `nest build`).
    swc.vite(),
  ],
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
    // The skeleton created by this change has no specs yet (later tasks add
    // them layer by layer); don't fail the run just because none exist.
    passWithNoTests: true,
  },
});
