/**
 * Enforces the layer dependency direction from
 * openspec/changes/2-nest-server-foundation/design.md (D3):
 *
 *   api            -> runtime, application, infrastructure, domain, config
 *   runtime        -> application, infrastructure, domain, config
 *   application    -> infrastructure, domain, config
 *   infrastructure -> domain, config
 *   domain         -> domain only (not even config)
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
      name: 'domain-is-pure',
      comment:
        'domain/ must not depend on anything outside domain/ (no config, no infrastructure, no application, no runtime, no api, no Nest). External npm packages are allowed.',
      severity: 'error',
      from: { path: '^src/domain' },
      to: {
        path: '^src',
        pathNot: '^src/domain',
      },
    },
    {
      name: 'infrastructure-layer-direction',
      comment:
        'infrastructure/ may only depend on domain/ and config/ (plus itself).',
      severity: 'error',
      from: { path: '^src/infrastructure' },
      to: {
        path: '^src',
        pathNot: '^src/(infrastructure|domain|config)',
      },
    },
    {
      name: 'application-layer-direction',
      comment:
        'application/ may only depend on infrastructure/, domain/ and config/ (plus itself).',
      severity: 'error',
      from: { path: '^src/application' },
      to: {
        path: '^src',
        pathNot: '^src/(application|infrastructure|domain|config)',
      },
    },
    {
      name: 'runtime-layer-direction',
      comment:
        'runtime/ may only depend on application/, infrastructure/, domain/ and config/ (plus itself).',
      severity: 'error',
      from: { path: '^src/runtime' },
      to: {
        path: '^src',
        pathNot: '^src/(runtime|application|infrastructure|domain|config)',
      },
    },
    {
      name: 'api-layer-direction',
      comment:
        'api/ may depend on runtime/, application/, infrastructure/, domain/ and config/ (plus itself).',
      severity: 'error',
      from: { path: '^src/api' },
      to: {
        path: '^src',
        pathNot: '^src/(api|runtime|application|infrastructure|domain|config)',
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
