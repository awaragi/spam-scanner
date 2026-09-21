# Multi-stage Dockerfile for spam-scanner
# Stage 1: Builder - Install production dependencies
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Stage 2: Runtime - Final image with minimal footprint
FROM node:24-alpine

WORKDIR /app

# Copy production dependencies from builder
COPY --from=builder --chown=node:node /app/node_modules ./node_modules

# Copy application source
COPY --chown=node:node src ./src

# Copy package.json for version info
COPY --chown=node:node package.json ./

# Copy Docker entrypoint script
COPY --chown=node:node bin/docker ./bin/docker

# Make entrypoint executable
RUN chmod +x /app/bin/docker/entrypoint.sh

# Run as the image's built-in non-root user - the app has no need for root
# (all state lives in IMAP/rspamd/redis, not the local filesystem)
USER node

# Set entrypoint
ENTRYPOINT ["/app/bin/docker/entrypoint.sh"]
