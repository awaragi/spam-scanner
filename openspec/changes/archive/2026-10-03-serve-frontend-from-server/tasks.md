# Tasks

## 1. Server: `/api` prefix

- [x] 1.1 In `server/src/main.ts`, add `app.setGlobalPrefix('api')` before the
      `SwaggerModule.createDocument(...)` call. Verify with
      `npm test --workspace=server` and `npm run lint --workspace=server`
      (both pass unchanged - no existing test asserts on a raw route path).
- [x] 1.2 Start the server (`docker compose up -d server` from repo root, or
      `bin/local/server-dev.sh`) and verify `curl http://localhost:3000/api/health/live`
      returns the liveness payload while `curl http://localhost:3000/health/live`
      (no prefix) 404s.
- [x] 1.3 Verify `curl http://localhost:3000/api/docs-json` (the generated
      OpenAPI document) lists every operation path under `/api` (e.g.
      `/api/auth/login`, `/api/admin/accounts`), confirming task 1.1's
      ordering took effect.

## 2. Server: static frontend hosting

- [x] 2.1 Add `@nestjs/serve-static` (`^12.0.0`) to `server/package.json`'s
      dependencies and verify `npm ci --workspace=server` resolves it
      cleanly against the root lockfile.
- [x] 2.2 In `server/src/app.module.ts`, import `ServeStaticModule.forRoot({
      rootPath: join(import.meta.dirname, '..', 'public'), exclude: [/^\/api(\/|$)/] })`
      per design.md D1/D2/D3/D5. Verify `npm run build --workspace=server`
      compiles with no type errors.
- [x] 2.3 Manually build the front and drop its output where the server
      expects it (`mkdir -p server/public && cp -r front/dist/front/browser/*
      server/public/`), then run the server locally
      (`npm run start:dev --workspace=server` or equivalent) and verify
      `curl http://localhost:3000/` returns the built `index.html`,
      `curl http://localhost:3000/admin` (a client-side route) also returns
      `index.html` (the SPA fallback), and
      `curl http://localhost:3000/api/health/live` still returns the API
      response rather than the app shell. Delete the manually-populated
      `server/public` afterwards (task 3 makes it a proper Docker-build
      artifact).

## 3. Docker: build and ship the frontend with the server image

- [x] 3.1 In `server/Dockerfile`, add a `front-builder` stage (after the
      existing `builder` stage, same pattern: repo-root context, copy
      `package*.json` + `front/package.json`, `npm ci --workspace=front`,
      copy `front/src`, `front/public`, `front/angular.json`,
      `front/tsconfig*.json`, run `npm run build --workspace=front`).
- [x] 3.2 In the runtime stage, add
      `COPY --from=front-builder --chown=node:node /app/front/dist/front/browser ./server/public`.
- [x] 3.3 Verify with `docker compose build server && docker compose up -d server`
      from the repo root, then repeat 2.3's three `curl` checks
      (`/`, `/admin`, `/api/health/live`) against the running container -
      this time from the real Docker-built image, no manual copy.
- [x] 3.4 Add `server/public` to the repo root `.gitignore` (it's a build
      artifact, never checked in) and verify `git status` shows it ignored
      after task 3.3's build.

## 4. Front: relative API base URL and dev proxy

- [x] 4.1 Change `front/src/environments/environment.ts`'s `apiBaseUrl` from
      `http://localhost:3000` to `/api`, and verify
      `npm run build --workspace=front` still succeeds (no other file
      hard-codes the old absolute URL - confirmed during design research).
- [x] 4.2 Add `front/proxy.conf.json` (`{"/api": {"target":
      "http://localhost:3000", "changeOrigin": true}}`) and wire it into
      `front/angular.json`'s `architect.serve.options.proxyConfig`.
- [x] 4.3 With the server running (`docker compose up -d` from repo root),
      run `npm start --workspace=front` and verify in a browser that
      `http://localhost:4200` loads, the login page can reach
      `POST /api/auth/login` through the proxy (network tab shows a
      same-origin `4200` request, proxied to `3000`), and no CORS error
      appears in the console.

## 5. Full-stack verification

- [x] 5.1 From a clean `docker compose up -d` (repo root), verify the full
      path end to end with `curl`: `GET /` (app shell), a static asset path
      referenced from that HTML (e.g. the hashed main JS file), `GET /admin`
      (SPA fallback), `POST /api/auth/login` with the configured admin
      password (expect a token back), and `GET /api/health/live`.
- [x] 5.2 Run `turbo run build && turbo run test && turbo run lint` from the
      repo root and verify all three succeed across `server`, `front`, and
      `shared`.
