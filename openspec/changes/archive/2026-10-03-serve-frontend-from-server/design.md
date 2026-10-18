# Design

## Context

See `proposal.md` - Why. Today: `server/` exposes unprefixed controllers
(`/auth`, `/admin`, `/mailboxes/:id`, `/health`, `/admin/accounts`), already
documents them at Swagger path `api/docs`, and allows cross-origin calls
from `http://localhost:4200` via `app.enableCors(...)`. `front/` is an
Angular 22 app (new esbuild `@angular/build:application` builder, CSR only,
path-based routing - no hash strategy), built with `ng build` to
`front/dist/front/browser/` (confirmed by running the build), and has no
Docker image of its own. `server/package.json` has `"type": "module"` and
`server/tsconfig.json` already sets `"module": "nodenext"`.

## Goals / Non-Goals

**Goals:**
- One container serves both the API and the UI.
- The dev workflow (`ng serve`) keeps working against the same running
  server, without relying on CORS.
- The API's shape (paths below `/api`, auth, responses) is otherwise
  unchanged.

**Non-Goals:**
- No SSR/prerendering for the Angular app - static CSR output only.
- No change to how the server is deployed (still one Compose service, one
  image) or to `docker-compose.yml`.
- No change to auth, token scoping, or any other `server/api-auth`
  behavior - only the path prefix moves.

## Decisions

**D1 - `@nestjs/serve-static` for static hosting, not hand-rolled
middleware.** It's the maintained Nest wrapper around `serve-static`/Express
static handling, matches [[feedback_prefer_libraries_over_hand_rolled]], and
its `ServeStaticModule.forRoot()` already does what's needed: serve files
from `rootPath` and fall back to `index.html` for unmatched paths (the SPA
fallback) via its built-in catch-all. Version `^12.0.0` (the version aligned
with `@nestjs/core@^12`) peer-depends on `express@^5.0.1`; the server
already resolves `express@5.2.1` transitively through
`@nestjs/platform-express@12.1.0`, so no version conflict. It ships ESM-only
and requires Node `^20.19 || ^22.12 || >=23`, both already satisfied
(`"type": "module"`, `node:24-alpine` in the Dockerfile, `"module":
"nodenext"` in `tsconfig.json`).

**D2 - Exclude the catch-all with a `RegExp`, not a string glob.** Express 5
(bundled transitively here) uses `path-to-regexp` v6+, which rejects the
bare `*` wildcard the older Express-4-era examples use and instead wants a
named wildcard (`/api/{*splat}`). Rather than depend on knowing
`@nestjs/serve-static`'s exact internal string-pattern parsing for this
Express major version, pass `exclude: [/^\/api(\/|$)/]` - a plain `RegExp`
matched directly against the request path, sidestepping `path-to-regexp`
parsing entirely. This is also more obviously correct by inspection than a
glob string.

**D3 - Don't set `useGlobalPrefix` on `ServeStaticModule`.** That option
would move the *static app* under the global prefix too (the opposite of
what's wanted: the app shell stays at `/`, only the API moves to `/api`).
Leave it at its default (`false`); the split between static root and `/api`
is enforced by D1/D2 instead.

**D4 - `setGlobalPrefix('api')` before `SwaggerModule.createDocument(...)`
in `main.ts`.** `SwaggerModule.createDocument` walks the already-mounted
routes to build the OpenAPI document; the prefix must be set first or the
generated doc will describe the old unprefixed paths while the server
actually serves the new ones.

**D5 - `rootPath` resolved via `import.meta.dirname`, not `__dirname`.**
`server/package.json` is `"type": "module"`; there is no CJS `__dirname` at
runtime. `import.meta.dirname` (Node >=21.2/20.11, available on the
project's `node:24-alpine`) is the direct ESM equivalent, and is what
`@nestjs/serve-static`'s own README example uses. `ServeStaticModule.forRoot`
is added directly in `app.module.ts` (not inside `api/`'s own module),
since it's bootstrap-level wiring like `AppLoggingModule`, not a
domain/API concern - it needs no entry in `.dependency-cruiser.cjs`'s
layer rules, which already leave `app.module.ts` unconstrained.

**D6 - New Docker build stage `front-builder`, not a separate Dockerfile
or image.** Mirrors the existing `builder` stage's pattern (repo-root
context, `npm ci --workspace=front` against the root lockfile, then
`npm run build --workspace=front`), and copies only
`front/dist/front/browser/*` into the runtime stage's `server/public` -
the minimum needed, matching how the existing runtime stage already copies
only `dist/` output from `builder`, never `node_modules` or source. `front`
has no dependency on `shared`, so this stage needs no `shared` sources at
all, unlike the `server`/`shared` builder stage.

**D7 - `front/proxy.conf.json` + `angular.json`'s `serve.options.proxyConfig`,
not a CORS-based dev flow.** The Angular CLI dev-server proxy makes
`ng serve`'s API calls same-origin from the browser's point of view (the
proxy, not the browser, makes the cross-origin hop to `localhost:3000`), so
no preflight/CORS handling is needed for the request to succeed. `/api` is
the only path forwarded (no `ws: true` - the app has no WebSocket/SSE
usage).

**D8 - `environment.ts`'s `apiBaseUrl` becomes the relative `/api`, with no
`environment.prod.ts` split.** Only one environment file exists today, so
there's nothing to keep in sync; the same relative value is correct in dev
(proxied) and prod (same origin) alike, which is what makes D7 possible
without a build-time branch.

**D9 - `app.enableCors(...)` is left in place (explicit decision, not an
oversight).** It is no longer load-bearing for either shipped path (dev
goes through the D7 proxy; prod is same-origin), but removing it was
explicitly declined - it may still serve a direct cross-origin caller
outside the UI (e.g. hitting `:3000` directly from a `:4200` tab without
going through the proxy, or a future external client).

## Risks / Trade-offs

- [Risk] Every existing API consumer's hard-coded path breaks the moment
  `/api` lands (**BREAKING**, per proposal.md). -> Mitigation: the only
  in-repo consumer is `front/src/app/core/api.service.ts`, which centralizes
  every request path through one `base` constant (`environment.apiBaseUrl`)
  plus relative sub-paths; updating that one value is the whole fix on the
  client side. Anyone else hitting the server directly (scripts, manual
  `curl`) must add `/api` - called out plainly in the proposal's Impact
  section.
- [Risk] `@nestjs/serve-static`'s SPA-fallback catch-all could still shadow
  something unexpected if a future route is added outside both `/api` and
  the exclude pattern. -> Mitigation: D2's regex excludes everything under
  `/api`, which is the API's entire surface by D1; any future controller
  necessarily also lives under that prefix, so this stays correct without
  upkeep.
- [Risk] Running the server locally via `start:dev`/`bin/local/server-dev.sh`
  (outside Docker) has no `server/public` directory, since it's populated
  only by the Docker build stage. -> Mitigation: this is intentional (see
  proposal - the dev workflow serves the UI via `ng serve` + the D7 proxy,
  never via the Nest static server); `@nestjs/serve-static` serving from a
  missing directory simply 404s on unmatched paths rather than erroring at
  startup, so local dev is unaffected either way.

## Migration Plan

Single-step rollout, no data migration: rebuild the `server` image (now
including the `front-builder` stage) and redeploy via the existing
`docker-compose.yml`. Rollback is redeploying the previous image tag - no
schema, state-file, or IMAP-side changes are involved anywhere in this
change.
