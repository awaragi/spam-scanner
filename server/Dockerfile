# Multi-stage Dockerfile for the NestJS server (server/)
#
# Built from the REPO ROOT as context (`docker build -f server/Dockerfile .`),
# not from server/ alone, because this is an npm-workspaces monorepo and the
# lockfile lives only at the repo root.

# Stage 1: Builder - install all workspace deps (incl. devDependencies, needed
# for `nest build`) and compile TypeScript to dist/.
FROM node:24-alpine AS builder

WORKDIR /app

# Root workspace manifest + lockfile, plus this workspace's own package.json
# and `shared`'s (server imports `shared` as a real workspace package at
# runtime), mirroring the monorepo layout so `npm ci` resolves every
# workspace declared in the root manifest.
COPY package*.json ./
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json

RUN npm ci --workspace=server --workspace=shared

# Source needed to build (nest-cli.json's sourceRoot: "src").
COPY shared/src ./shared/src
COPY shared/vite.config.ts ./shared/vite.config.ts
COPY shared/tsconfig.json ./shared/tsconfig.json
COPY server/src ./server/src
COPY server/tsconfig*.json ./server/
COPY server/nest-cli.json ./server/nest-cli.json

# `shared` first - `server`'s build imports its compiled `dist/` output.
RUN npm run build --workspace=shared
RUN npm run build --workspace=server

# Stage 2: Runtime - fresh production-only install (never copies node_modules
# from the builder stage, which would carry devDependencies across) plus the
# compiled dist/.
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
COPY server/package.json ./server/package.json
COPY shared/package.json ./shared/package.json

RUN npm ci --workspace=server --workspace=shared --omit=dev

COPY --from=builder --chown=node:node /app/server/dist ./server/dist
COPY --from=builder --chown=node:node /app/shared/dist ./shared/dist

# Run as the image's built-in non-root user - the app has no need for root
# (all state lives in IMAP/rspamd, not the local filesystem).
USER node

ENTRYPOINT ["node", "server/dist/main.js"]
