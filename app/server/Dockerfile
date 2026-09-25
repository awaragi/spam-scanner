# Multi-stage Dockerfile for the NestJS server (app/server)
#
# Built from the REPO ROOT as context (`docker build -f app/server/Dockerfile .`),
# not from app/server alone, because this is an npm-workspaces monorepo and the
# lockfile lives only at the repo root. This deliberately avoids the gap
# `terminal/`'s Dockerfile hit in `1-monorepo-restructure` (its `npm ci` fails
# because it can no longer find the lockfile inside `terminal/`).

# Stage 1: Builder - install all workspace deps (incl. devDependencies, needed
# for `nest build`) and compile TypeScript to dist/.
FROM node:24-alpine AS builder

WORKDIR /app

# Root workspace manifest + lockfile, plus this workspace's own package.json,
# mirroring the monorepo layout so `npm ci --workspace=app/server` resolves.
COPY package*.json ./
COPY app/server/package.json ./app/server/package.json

RUN npm ci --workspace=app/server

# Source needed to build (nest-cli.json's sourceRoot: "src").
COPY app/server/src ./app/server/src
COPY app/server/tsconfig*.json ./app/server/
COPY app/server/nest-cli.json ./app/server/nest-cli.json

RUN npm run build --workspace=app/server

# Stage 2: Runtime - fresh production-only install (never copies node_modules
# from the builder stage, which would carry devDependencies across) plus the
# compiled dist/.
FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
COPY app/server/package.json ./app/server/package.json

RUN npm ci --workspace=app/server --omit=dev

COPY --from=builder --chown=node:node /app/app/server/dist ./app/server/dist

# Run as the image's built-in non-root user - the app has no need for root
# (all state lives in IMAP/rspamd, not the local filesystem).
USER node

ENTRYPOINT ["node", "app/server/dist/main.js"]
