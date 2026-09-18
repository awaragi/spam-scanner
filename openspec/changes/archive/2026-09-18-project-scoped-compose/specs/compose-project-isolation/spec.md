# Spec Delta

## Purpose

Ensures the production (`docker-compose.yml`) and local dev (`bin/local/docker-compose.yml`) Compose stacks are isolated from each other and from other instances purely by Compose project name, so multiple stacks can run side by side on one host.

## ADDED Requirements

### Requirement: No hard-coded container names
Neither `docker-compose.yml` nor `bin/local/docker-compose.yml` SHALL declare a `container_name` on any service. Container names SHALL be left to Compose's default derivation (`<project>-<service>-<n>`), which is namespaced by the Compose project name.

#### Scenario: Dev and production stacks start simultaneously
- **WHEN** the production stack is started with `docker compose up -d` from the project root, and the dev stack is started with `bin/local/rspamd.sh up` using a different Compose project name
- **THEN** both stacks start successfully with no "container name already in use" error

#### Scenario: Two independent stacks for different mailboxes
- **WHEN** two stacks are started from the same compose file with distinct `-p`/`COMPOSE_PROJECT_NAME` values (e.g. `spam-scanner-family`, `spam-scanner-work`)
- **THEN** each stack's containers are named using its own project prefix and neither collides with the other's container names

### Requirement: Consistent project-scoped network declaration
Both `docker-compose.yml` and `bin/local/docker-compose.yml` SHALL declare a network using the same network key (no hard-coded literal `name:` that would be shared across distinct Compose projects), so each is namespaced by its own Compose project name and stacks under different project names never join the same network.

#### Scenario: Dev and production networks do not overlap
- **WHEN** the production stack and the dev stack are each started under different Compose project names
- **THEN** each stack's services join a network scoped to its own project, and containers from one stack cannot reach containers from the other over that network

#### Scenario: Services within one stack share a network
- **WHEN** either compose file is started
- **THEN** all services declared in that file join the same project-scoped network and can reach each other by service name

### Requirement: Documented multi-stack usage
The project's documentation (`README.md` and/or `bin/local/rspamd.sh` usage text) SHALL describe how to run more than one isolated stack on the same host using `-p <name>` / `COMPOSE_PROJECT_NAME`, including the dev-plus-production case and the multiple-mailboxes case.

#### Scenario: Operator looks up how to run two stacks
- **WHEN** an operator reads the documented instructions for running parallel stacks
- **THEN** they find a concrete example command using `-p`/`COMPOSE_PROJECT_NAME` for both the production compose file and `bin/local/docker-compose.yml`
