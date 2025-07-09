FROM node:20-slim

RUN apt-get update && apt-get install -y \
    spamassassin spamc sa-compile gnupg re2c gcc make tini \
    wget procps less nano \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Production level local.cf
RUN mv /etc/spamassassin/local.cf /etc/spamassassin/local.cf.factory
COPY local.cf /etc/spamassassin/local.cf

RUN wget https://mcgrail.com/downloads/kam.sa-channels.mcgrail.com.key
RUN sa-update -v --import kam.sa-channels.mcgrail.com.key
RUN sa-update -v --gpgkey 24C063D8 --channel kam.sa-channels.mcgrail.com
RUN rm kam.sa-channels.mcgrail.com.key
RUN sa-compile

RUN useradd -ms /bin/bash sauser

# Create application folder and spamassassin directory
RUN mkdir -p /app/ /home/sauser/.spamassassin
RUN echo $(date -u +"%Y-%m-%dT%H:%M:%SZ") > /home/sauser/.spamassassin/created.txt
RUN chown -R sauser:sauser /app /home/sauser
RUN chmod 755 /home/sauser/.spamassassin
WORKDIR /app

# Execute on its own to speed rebuild
COPY package*.json /app/
RUN npm install --omit=dev

# Copy files from src/ directly to /app/ (no src folder in container)
COPY src/ /app/

USER sauser
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["once"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD echo "X-Spam-Check" | spamc -c > /dev/null || exit 1
