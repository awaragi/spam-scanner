import { describe, test, expect, vi, afterEach } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseEnvFile } from 'dotenv';
import { migrateEnvFile, migrateEnvValues } from './migrate-env.js';

/**
 * Fixture env files under `test-fixtures/` are hand-written, fake data - the
 * spec never reads a real `.env` (see the `server/configuration` spec's
 * migration requirement, and design.md D10: "the assistant never reads a
 * real .env, and the operator runs the script").
 */
const fixturesDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'test-fixtures',
);

function fixturePath(name: string): string {
  return join(fixturesDir, name);
}

/** A fresh, isolated output path per test - never a real `.env`. */
function tempOutputPath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'migrate-env-spec-'));
  return { dir, path: join(dir, 'server.env') };
}

describe('migrateEnvValues', () => {
  test('a typical source file: app settings unchanged, mailbox connection mapped, per-mailbox thresholds dropped, defaults filled', () => {
    const source = parseFixture('typical.env');
    const result = migrateEnvValues(source);

    // App settings carried forward unchanged.
    expect(result.appSettingKeysCarried.sort()).toEqual(
      [
        'RSPAMD_URL',
        'RSPAMD_PASSWORD',
        'AI_ENABLED',
        'AI_BASE_URL',
        'AI_API_KEY',
        'AI_MODEL',
        'SCAN_INTERVAL',
      ].sort(),
    );
    expect(result.content).toContain(
      'RSPAMD_URL=http://rspamd.fixture.internal:11334',
    );
    expect(result.content).toContain('AI_MODEL=gpt-4o-mini');
    expect(result.content).toContain('SCAN_INTERVAL=120');

    // Mailbox connection mapped to the server's key names.
    expect(result.mailboxKeysMapped.sort()).toEqual(
      [
        'MAILBOX_IMAP_HOST',
        'MAILBOX_IMAP_PORT',
        'MAILBOX_IMAP_USER',
        'MAILBOX_IMAP_PASSWORD',
        'MAILBOX_IMAP_TLS',
        'MAILBOX_IMAP_ALLOW_INSECURE',
        'MAILBOX_STATE_FOLDER',
      ].sort(),
    );
    expect(result.content).toContain(
      'MAILBOX_IMAP_HOST=imap.fixture.example.com',
    );
    expect(result.content).toContain(
      'MAILBOX_IMAP_USER=owner@fixture.example.com',
    );
    expect(result.content).toContain(
      'MAILBOX_STATE_FOLDER=INBOX.scanner.state',
    );
    expect(result.mailboxIdSource).toBe('IMAP_USER');
    expect(result.content).toContain('MAILBOX_ID=owner@fixture.example.com');

    // Per-mailbox behavioral settings are dropped, not carried forward.
    expect(result.droppedKeys.sort()).toEqual(
      [
        'FOLDER_INBOX',
        'SPAM_CLEAN_THRESHOLD',
        'SPAM_LOW_THRESHOLD',
        'SCAN_READ',
      ].sort(),
    );
    for (const droppedLine of [
      'FOLDER_INBOX=',
      'SPAM_CLEAN_THRESHOLD=',
      'SPAM_LOW_THRESHOLD=',
      'SCAN_READ=',
    ]) {
      expect(
        result.content.split('\n').some((line) => line.startsWith(droppedLine)),
      ).toBe(false);
    }

    // Schema defaults filled in for anything the source never set.
    expect(result.content).toContain('RSPAMD_TIMEOUT_MS=30000');
    expect(result.content).toContain('BATCH_SCAN_SIZE=200');
    expect(result.content).toContain('PORT=3000');
    expect(result.content).toContain('LOG_LEVEL=info');
  });

  test('no email-shaped value in IMAP_USER or IMAP_NOTIFY_ADDRESS leaves MAILBOX_ID empty', () => {
    const source = parseFixture('no-email-shaped-value.env');
    const result = migrateEnvValues(source);

    expect(result.mailboxIdSource).toBeNull();
    expect(result.content.split('\n')).toContain('MAILBOX_ID=');
  });
});

describe('migrateEnvFile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('writes the migrated file and reports counts for a typical source file', () => {
    const { dir, path: outputPath } = tempOutputPath();
    try {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      migrateEnvFile(fixturePath('typical.env'), outputPath);

      const written = readFileSync(outputPath, 'utf-8');
      expect(written).toContain('MAILBOX_IMAP_HOST=imap.fixture.example.com');
      expect(
        logSpy.mock.calls.some(
          (call) =>
            typeof call[0] === 'string' &&
            call[0].includes('7 app-setting key(s) carried forward') &&
            call[0].includes('7 mailbox-connection key(s) mapped') &&
            call[0].includes('4 key(s) dropped') &&
            call[0].includes('MAILBOX_ID derived from IMAP_USER'),
        ),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('warns the operator when no mailbox id can be derived, without failing', () => {
    const { dir, path: outputPath } = tempOutputPath();
    try {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      expect(() =>
        migrateEnvFile(fixturePath('no-email-shaped-value.env'), outputPath),
      ).not.toThrow();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]?.join(' ')).toContain('MAILBOX_ID');

      const written = readFileSync(outputPath, 'utf-8');
      expect(written.split('\n')).toContain('MAILBOX_ID=');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('never surfaces a secret value in console output, even though the output file legitimately carries it', () => {
    const { dir, path: outputPath } = tempOutputPath();
    try {
      const secrets = [
        'FixtureImapSecretPass789',
        'FixtureRspamdSecretHash456',
        'sk-fixture-SecretApiKey123',
      ];
      const capturedOutput: string[] = [];
      const capture = (...args: unknown[]) => {
        capturedOutput.push(args.map((arg) => String(arg)).join(' '));
      };
      vi.spyOn(console, 'log').mockImplementation(capture);
      vi.spyOn(console, 'warn').mockImplementation(capture);
      vi.spyOn(console, 'error').mockImplementation(capture);

      migrateEnvFile(fixturePath('contains-secrets.env'), outputPath);

      const allConsoleOutput = capturedOutput.join('\n');
      for (const secret of secrets) {
        expect(allConsoleOutput).not.toContain(secret);
      }

      // The output file's own env-var lines legitimately carry the secrets
      // forward - that's the file's job, distinct from console/log output.
      const written = readFileSync(outputPath, 'utf-8');
      for (const secret of secrets) {
        expect(written).toContain(secret);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function parseFixture(name: string): Record<string, string> {
  return parseEnvFile(readFileSync(fixturePath(name), 'utf-8'));
}
