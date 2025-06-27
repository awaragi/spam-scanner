FROM node:20-slim

RUN apt-get update && apt-get install -y \
    spamassassin \
    spamc \
    gnupg \
    ca-certificates \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY src/ .

RUN npm install

ENTRYPOINT ["./start.sh"]
