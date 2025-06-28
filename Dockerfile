FROM node:20-slim

RUN apt-get update && apt-get install -y \
    spamassassin \
    spamc \
    gnupg \
    ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

# Copy application
WORKDIR /app
COPY src/ .
# Install nodejs dependencies
RUN npm install

# Copy txrep configuration file
COPY txrep.cf.example /etc/mail/spamassassin/txrep.cf

# Start point
ENTRYPOINT ["./start.sh"]
