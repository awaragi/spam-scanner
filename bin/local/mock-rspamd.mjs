/**
 * Lightweight stand-in for the rspamd HTTP controller (no Bayes, Redis, or DNS).
 * Binds 127.0.0.1:11334 by default so local RSPAMD_URL needs no change.
 */
import express from 'express';

const HOST = process.env.MOCK_RSPAMD_HOST ?? '127.0.0.1';
const PORT = Number(process.env.MOCK_RSPAMD_PORT ?? '11334');
const REQUIRED_SCORE = 15;
const HAM_SCORE = 0;
const SPAM_SCORE = 30;

let checkCount = 0;

const app = express();

app.use(express.raw({ type: () => true, limit: '32mb' }));

function hamPayload() {
  return {
    action: 'no action',
    score: HAM_SCORE,
    required_score: REQUIRED_SCORE,
    symbols: {},
  };
}

function spamPayload() {
  return {
    action: 'reject',
    score: SPAM_SCORE,
    required_score: REQUIRED_SCORE,
    symbols: {},
  };
}

app.get('/ping', (_req, res) => {
  res.type('text/plain').send('pong');
});

app.post('/checkv2', (req, res) => {
  const n = ++checkCount;
  const ham = n % 2 === 1;
  const payload = ham ? hamPayload() : spamPayload();
  console.log(
    `[mock-rspamd] checkv2 #${n} → ${ham ? 'ham' : 'spam'} (score ${payload.score}/${REQUIRED_SCORE})`,
  );
  res.json(payload);
});

function learnOk(label, req, res) {
  console.log(`[mock-rspamd] ${label} (${req.body?.length ?? 0} bytes)`);
  res.json({ success: true });
}

app.post('/learnham', (req, res) => learnOk('learnham', req, res));
app.post('/learnspam', (req, res) => learnOk('learnspam', req, res));

app.use((_req, res) => {
  res.status(404).type('text/plain').send('not found');
});

const server = app.listen(PORT, HOST, () => {
  console.log(
    `[mock-rspamd] listening on http://${HOST}:${PORT} (checkv2 alternates ham/spam)`,
  );
});

function shutdown(signal) {
  console.log(`[mock-rspamd] ${signal}, shutting down`);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
