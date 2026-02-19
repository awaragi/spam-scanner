# Multi-stage Dockerfile for spam-scanner
# Stage 1: Builder - Install production dependencies
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Stage 2: Runtime - Final image with minimal footprint
FROM node:20-alpine

WORKDIR /app

# Copy production dependencies from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy application source
COPY src ./src

# Copy Docker entrypoint script
COPY bin/docker ./bin/docker

# Make entrypoint executable
RUN chmod +x /app/bin/docker/entrypoint.sh

# Set entrypoint
ENTRYPOINT ["/app/bin/docker/entrypoint.sh"]
