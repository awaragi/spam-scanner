import fs from 'fs';
import path from 'path';
import { simpleParser } from 'mailparser';
import { config } from '../../src/lib/core/config.ts';
import { extractAiContent } from '../../src/lib/services/ai-content.service.ts';
import { classifyEmail } from '../../src/lib/clients/ai.client.ts';

// Opt-in only: makes real calls to the configured AI provider using real API
// credentials. Skipped entirely unless local .eml fixtures are present under
// .temp/messages/ham (gitignored - never committed).
//
// Run with: npm run test:integration
// (loads AI_* config, including AI_API_KEY, from .env via env-cmd - this test
// file and the agent that wrote it never read .env directly)

const FIXTURES_ROOT = path.resolve(process.cwd(), '.temp/messages');
const HAM_DIR = path.join(FIXTURES_ROOT, 'ham');
const SPAM_DIR = path.join(FIXTURES_ROOT, 'spam');

function listEmlFixtures(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter(name => name.toLowerCase().endsWith('.eml'))
      .map(name => ({ file: path.join(dir, name), label: name }));
  } catch {
    return [];
  }
}

const hamFixtures = listEmlFixtures(HAM_DIR);
const spamFixtures = listEmlFixtures(SPAM_DIR);

async function classifyFixture(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const parsed = await simpleParser(raw);
  const message = {
    uid: 0,
    envelope: {
      from: parsed.from?.value ?? [],
      to: parsed.to?.value ?? [],
      subject: parsed.subject ?? '',
      date: parsed.date ?? null,
    },
    raw,
  };

  const content = await extractAiContent(message, {
    maxInputTokens: config.AI_MAX_INPUT_TOKENS,
  });
  return classifyEmail(content);
}

describe.skipIf(hamFixtures.length === 0)(
  'AI live classification (integration)',
  () => {
    test.each(hamFixtures)(
      'ham: $label should not escalate past the high-spam threshold',
      async ({ file, label }) => {
        const { score, reasoning } = await classifyFixture(file);
        console.log(`[ham] ${label}: score=${score} reasoning=${reasoning}`);

        expect(
          score,
          `expected below AI_ESCALATE_TO_HIGH_THRESHOLD (${config.AI_ESCALATE_TO_HIGH_THRESHOLD}), got ${score} - reasoning: ${reasoning}`
        ).toBeLessThan(config.AI_ESCALATE_TO_HIGH_THRESHOLD);
      }
    );

    test.each(spamFixtures)(
      'spam: $label should be flagged as at least low spam',
      async ({ file, label }) => {
        const { score, reasoning } = await classifyFixture(file);
        console.log(`[spam] ${label}: score=${score} reasoning=${reasoning}`);

        expect(
          score,
          `expected at/above AI_ESCALATE_TO_LOW_THRESHOLD (${config.AI_ESCALATE_TO_LOW_THRESHOLD}), got ${score} - reasoning: ${reasoning}`
        ).toBeGreaterThanOrEqual(config.AI_ESCALATE_TO_LOW_THRESHOLD);
      }
    );
  }
);
