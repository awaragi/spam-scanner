# Proposal

## Why

The Angular control UI (`front/`) currently has no deployment story of its
own: it's dev-only, run via `ng serve` against the server's CORS-allowed
`localhost:4200` origin. Shipping it today would mean standing up a second
container just to serve static files. Since the UI is a thin client over the
server's own HTTP API, the server can serve both from one process and one
Docker image, with no new container.

## What Changes

- **BREAKING**: every server HTTP API route moves under a `/api` prefix
  (`app.setGlobalPrefix('api')`), e.g. `/auth/login` -> `/api/auth/login`,
  `/health/live` -> `/api/health/live`. Swagger already anticipated this
  (`api/docs`); the prefix makes the rest of the surface consistent with it.
- The server serves the built Angular app's static files at `/` via
  `@nestjs/serve-static`, with an SPA fallback to `index.html` for
  client-side routes (`/login`, `/admin`, `/mailbox/:id`) on direct
  navigation/refresh, and an `exclude` rule so that fallback never shadows
  `/api/*`.
- `server/Dockerfile` gains a `front-builder` stage (repo root context, same
  `npm ci --workspace` pattern as the existing `shared`/`server` stages)
  that builds `front` and copies its output into the runtime image at
  `server/public`, resolved at runtime via `join(__dirname, '..', 'public')`
  from `server/dist/main.js`. No new Docker Compose service.
- `front`'s `environment.ts` `apiBaseUrl` changes from the absolute
  `http://localhost:3000` to the relative `/api`, so the same build works
  unchanged whether it's served by the Nest server (prod) or proxied in dev.
- New `front/proxy.conf.json` (`/api` -> `http://localhost:3000`), wired
  into `front/angular.json`'s `serve.options.proxyConfig`, so `ng serve`
  keeps working against the same running server without CORS doing the
  work.
- `app.enableCors(...)` in `server/src/main.ts` is left as-is (not removed),
  per explicit instruction - it's no longer load-bearing for the shipped
  dev/prod paths but may still serve a direct cross-origin caller.

## Capabilities

### New Capabilities

- `server/static-frontend`: the server's HTTP surface layout - the built
  Angular app served as static files (with SPA fallback) at `/`, and the
  API confined to `/api`, so the two never collide on one origin.

### Modified Capabilities

*(none - `server/api-auth`'s requirements are path-agnostic; moving routes
under `/api` doesn't change any of its requirement text)*

## Impact

- `server/src/main.ts` - `setGlobalPrefix('api')` added before
  `SwaggerModule.createDocument(...)` (ordering matters: the generated
  OpenAPI doc must already see the prefix).
- `server/src/app.module.ts` - `ServeStaticModule.forRoot(...)` added
  alongside the other bootstrap-level imports.
- `server/package.json` - new dependency `@nestjs/serve-static`.
- `server/Dockerfile` - new `front-builder` stage; runtime stage gains a
  `COPY --from=front-builder` into `server/public`.
- `front/src/environments/environment.ts`, `front/angular.json`,
  new `front/proxy.conf.json`.
- Every existing API consumer (the Angular UI, Swagger "try it out", any
  script hitting the server directly) must add `/api` to its request paths.
