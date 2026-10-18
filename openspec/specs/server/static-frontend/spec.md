# server/static-frontend Specification

## Purpose

Defines how the server's single HTTP origin is split between the built
Angular control UI (served as static files) and the server's own control
API, so one process and one container can serve both without the two
colliding on a route.

## Requirements

### Requirement: The API is confined to an `/api` prefix
Every server HTTP API route SHALL be reachable only under an `/api` path
prefix. No API route SHALL be reachable at its unprefixed path.

#### Scenario: Health check is served under the prefix
- **WHEN** a client sends `GET /api/health/live`
- **THEN** the server responds with the liveness status

#### Scenario: Unprefixed API path is not served
- **WHEN** a client sends `GET /health/live` (no `/api` prefix)
- **THEN** the server does not route it to the health check handler

### Requirement: The built frontend is served as static files at the root origin
The server SHALL serve the Angular app's built static assets (JS, CSS,
images, `index.html`) at `/`, from the same origin and port as the API.

#### Scenario: Root path serves the app shell
- **WHEN** a client sends `GET /`
- **THEN** the server responds with the built `index.html`

#### Scenario: Static asset is served
- **WHEN** a client requests a hashed JS/CSS file the Angular build produced
- **THEN** the server responds with that file's contents

### Requirement: Unknown non-API paths fall back to the app shell
Because the Angular app uses client-side (path-based, non-hash) routing, a
direct navigation or page refresh on one of its routes must still succeed.
For any request path that is not under `/api` and does not match a static
asset the build produced, the server SHALL respond with the built
`index.html` so the client-side router can take over.

#### Scenario: Direct navigation to a client route succeeds
- **WHEN** a client sends `GET /admin` or `GET /mailbox/some-id` directly
  (not via an in-app navigation)
- **THEN** the server responds with the built `index.html`

#### Scenario: Fallback never shadows the API
- **WHEN** a client sends a request under `/api` for a route that does not
  exist
- **THEN** the server responds with the API's own not-found error, not the
  app shell

### Requirement: The server's generated API documentation reflects the prefix
The server's generated OpenAPI document SHALL describe every API operation
at its actual `/api`-prefixed path, not its unprefixed internal route.

#### Scenario: Documented path includes the prefix
- **WHEN** a client fetches the generated OpenAPI document
- **THEN** every documented operation path begins with `/api`
