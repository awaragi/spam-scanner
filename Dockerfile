FROM node:20-slim

RUN apt-get update && apt-get install -y \
    spamassassin \
    spamc \
    gnupg \
    ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Ensure SpamAssassin directory exists with proper permissions
RUN mkdir -p /root/.spamassassin

# Copy application
WORKDIR /app

# Copy package.json first for better Docker layer caching
COPY package.json ./
# Install nodejs dependencies
RUN npm install

# Copy the rest of the application
COPY src/ ./

# Start point
ENTRYPOINT ["./start.sh"]