# server/api-auth Specification

## Purpose
Governs how HTTP callers authenticate to the server: exchanging an admin
password for a short-lived admin token, exchanging an admin token for a
mailbox-scoped token, and how those two token scopes gate every protected
route.

## Requirements

### Requirement: Admin login exchanges a password for a short-lived admin token
The server SHALL expose an unauthenticated login endpoint that accepts a
password and compares it against a single admin password held in the
server's environment configuration. When the password matches, the server
SHALL return a signed, short-lived admin token. When it does not match, the
server SHALL reject the request with an authentication failure and SHALL NOT
return a token. The comparison SHALL NOT reveal, through its response body or
status, anything about the configured password beyond whether the supplied
value matched.

#### Scenario: Correct password returns an admin token
- **WHEN** a caller posts the configured admin password to the login endpoint
- **THEN** the server responds with a signed admin token that expires after
  the configured admin-token lifetime

#### Scenario: Wrong password is rejected without a token
- **WHEN** a caller posts an incorrect password to the login endpoint
- **THEN** the server responds with an authentication failure and no token

#### Scenario: Missing or malformed login body is rejected
- **WHEN** a caller posts a request whose body does not contain a password
  string
- **THEN** the server rejects the request as invalid input and issues no
  token

### Requirement: An admin token can be exchanged for a mailbox-scoped token
The server SHALL expose an endpoint, callable only with a valid admin token,
that exchanges the admin token for a mailbox token scoped to a single
mailbox id. The server SHALL issue the mailbox token only when the requested
mailbox id is one the server manages; a request for an unknown mailbox id
SHALL be rejected. The returned mailbox token SHALL be a signed, short-lived
token that identifies exactly the one mailbox it was issued for.

#### Scenario: Admin exchanges for a known mailbox's token
- **WHEN** a caller with a valid admin token requests a token for a mailbox
  the server manages
- **THEN** the server returns a signed mailbox token scoped to that mailbox
  id, expiring after the configured mailbox-token lifetime

#### Scenario: Exchange for an unknown mailbox is rejected
- **WHEN** a caller with a valid admin token requests a token for a mailbox
  id the server does not manage
- **THEN** the server rejects the request and issues no mailbox token

#### Scenario: A mailbox token cannot be used to obtain another mailbox's token
- **WHEN** a caller presents a mailbox token to the exchange endpoint
- **THEN** the server rejects the request because the endpoint requires admin
  scope

### Requirement: Admin-scoped routes require a valid admin token
Every admin-scoped route SHALL require a valid, unexpired admin token. A
request carrying no token, an expired or unverifiable token, or a mailbox
token SHALL be rejected before the route's handler runs. A mailbox token
SHALL NEVER grant access to any admin-scoped route.

#### Scenario: Admin route rejects a mailbox token
- **WHEN** a caller presents a mailbox token to an admin-scoped route
- **THEN** the server rejects the request as unauthorized and the handler
  does not run

#### Scenario: Admin route rejects a missing or expired token
- **WHEN** a caller reaches an admin-scoped route with no token, or with an
  expired or tampered token
- **THEN** the server rejects the request as unauthorized

### Requirement: Mailbox-scoped routes require a mailbox token whose id matches the route
Every mailbox-scoped route SHALL require a valid, unexpired mailbox token
whose mailbox id matches the mailbox id in the route. A mailbox token issued
for one mailbox SHALL NOT grant access to another mailbox's routes. An admin
token SHALL NOT be accepted directly on a mailbox-scoped route; an admin
holder reaches mailbox routes by first exchanging for that mailbox's token.

#### Scenario: Matching mailbox token is accepted
- **WHEN** a caller presents a mailbox token whose id matches the mailbox id
  in the route
- **THEN** the request is authorized and the handler runs

#### Scenario: Mailbox token for a different mailbox is rejected
- **WHEN** a caller presents a mailbox token whose id does not match the
  mailbox id in the route
- **THEN** the server rejects the request as forbidden and the handler does
  not run

#### Scenario: An admin token is not accepted directly on a mailbox route
- **WHEN** a caller presents an admin token to a mailbox-scoped route
- **THEN** the server rejects the request, requiring a mailbox token instead

### Requirement: Token secret and admin password are required configuration
The server SHALL read the admin password and the token-signing secret from
its environment configuration, and SHALL fail to start when either is
missing or empty. Tokens SHALL be signed with that secret such that a token
signed by a different secret does not verify. Token lifetimes for admin and
mailbox tokens SHALL be configurable, each with a sensible default.

#### Scenario: Server refuses to start without an admin password or signing secret
- **WHEN** the server is started without an admin password or without a
  token-signing secret configured
- **THEN** startup fails with a configuration error naming the missing key,
  rather than starting with authentication disabled

#### Scenario: A token signed with a different secret is rejected
- **WHEN** a caller presents a token that is well-formed but was signed with
  a secret other than the server's configured signing secret
- **THEN** the server rejects the request as unauthorized
