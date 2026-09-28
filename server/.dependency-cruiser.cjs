/**
 * Enforces the layer dependency direction from
 * openspec/changes/2-nest-server-foundation/design.md (D3):
 *
 *   api            -> runtime, application, infrastructure, config
 *   runtime        -> application, infrastructure, config
 *   application    -> infrastructure, config
 *   infrastructure -> config
 *
 * (`domain/` was `src`'s innermost layer here; it's since moved out to the
 * `shared` package - see openspec/changes/flatten-monorepo-shared-domain.
 * Its purity is now structural: `shared` simply doesn't depend on `server`
 * in its own `package.json`, so there's nothing left for a rule to check.)
 *
 * Each layer may of course also import from within itself. `logging/` and
 * `main.ts` / `app.module.ts` are bootstrap wiring, not one of these layers,
 * and are intentionally left unconstrained here.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'infrastructure-layer-direction',
      comment: 'infrastructure/ may only depend on config/ (plus itself).',
      severity: 'error',
      from: { path: '^src/infrastructure' },
      to: {
        path: '^src',
        pathNot: '^src/(infrastructure|config)',
      },
    },
    {
      name: 'application-layer-direction',
      comment:
        'application/ may only depend on infrastructure/ and config/ (plus itself).',
      severity: 'error',
      from: { path: '^src/application' },
      to: {
        path: '^src',
        pathNot: '^src/(application|infrastructure|config)',
      },
    },
    {
      name: 'runtime-layer-direction',
      comment:
        'runtime/ may only depend on application/, infrastructure/ and config/ (plus itself).',
      severity: 'error',
      from: { path: '^src/runtime' },
      to: {
        path: '^src',
        pathNot: '^src/(runtime|application|infrastructure|config)',
      },
    },
    {
      name: 'api-layer-direction',
      comment:
        'api/ may depend on runtime/, application/, infrastructure/ and config/ (plus itself).',
      severity: 'error',
      from: { path: '^src/api' },
      to: {
        path: '^src',
        pathNot: '^src/(api|runtime|application|infrastructure|config)',
      },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
    doNotFollow: {
      path: ['node_modules'],
    },
  },
};
