FROM node:24.3.0-slim

RUN apt-get update && apt-get install -y \
    spamassassin \
    gnupg \
    ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Copy application
WORKDIR /app

# Copy package.json first for better Docker layer caching
COPY package.json ./

# Install nodejs dependencies
RUN npm install --omit=dev

# Copy the rest of the application
COPY src/ ./

ENV HOME=/var/lib/spamassassin

# Expose SpamAssassin configuration directories as volume
# VOLUME ["/root/.spamassassin", "/var/lib/spamassassin", "/etc/spamassassin", "/usr/share/spamassassin"]

# Start point
ENTRYPOINT ["./entrypoint.sh"]