FROM node:20-slim

RUN apt-get update && apt-get install -y \
    spamassassin \
    spamc \
    gnupg \
    ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Ensure SpamAssassin directory exists with proper permissions
RUN mkdir -p /var/lib/spamassassin && \
    chown -R root:root /var/lib/spamassassin && \
    chmod -R 755 /var/lib/spamassassin && \
    mkdir -p /etc/spamassassin/ && \
    chmod -R 755 /etc/spamassassin

# Copy application
WORKDIR /app

# Copy package.json first for better Docker layer caching
COPY package.json ./
# Install nodejs dependencies
RUN npm install

# Copy the rest of the application
COPY src/ ./

# Copy txrep configuration files
COPY init.pre.example /etc/spamassassin/init.pre
COPY local.cf.example /etc/spamassassin/local.cf
RUN chmod 644 \
    /etc/spamassassin/init.pre \
    /etc/spamassassin/local.cf

# Start point
ENTRYPOINT ["./start.sh"]