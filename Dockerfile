FROM node:20-slim

RUN apt-get update && apt-get install -y \
    spamassassin spamc sa-compile gnupg re2c gcc make tini wget \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash sauser

# Create application folder
RUN mkdir -p /app/
RUN chown -R sauser:sauser /app
WORKDIR /app

# Execute on its own to speed rebuild
COPY package*.json /app/
RUN npm install --omit=dev

# Copy files from src/ directly to /app/ (no src folder in container)
COPY src/ /app/

RUN wget https://mcgrail.com/downloads/kam.sa-channels.mcgrail.com.key \
    && sa-update --import kam.sa-channels.mcgrail.com.key \
    && rm kam.sa-channels.mcgrail.com.key

USER sauser
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["once"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD echo "X-Spam-Check" | spamc -c > /dev/null || exit 1