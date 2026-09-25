import { describe, test, expect, vi } from 'vitest';
import { AdminController, type AdminSettings } from './admin.controller.js';
import type { RunnerRegistry } from '../../runtime/runner-registry.js';
import type { HealthService, HealthReport } from '../health/health.service.js';
import {
  AiConfig,
  ApiAuthConfig,
  LoggingConfig,
  MailboxConnectionConfig,
  RspamdConfig,
  ScanConfig,
  ServerConfig,
} from '../../config/app-config.js';

function fixtureRspamdConfig(): RspamdConfig {
  return {
    url: 'http://rspamd:11333',
    password: 'super-secret-rspamd-password',
    timeoutMs: 5000,
    envelopeTrustedHops: 1,
  } as RspamdConfig;
}

function fixtureAiConfig(): AiConfig {
  return {
    enabled: true,
    baseUrl: 'https://api.openai.com',
    apiKey: 'super-secret-ai-key',
    model: 'gpt-4',
    timeoutMs: 30000,
    maxRetries: 3,
    concurrency: 2,
    maxInputTokens: 1000,
    maxOutputTokens: 200,
    failureAlertThreshold: 5,
  } as AiConfig;
}

function fixtureScanConfig(): ScanConfig {
  return {
    scanIntervalSeconds: 300,
    batchScanSize: 50,
    batchProcessSize: 10,
    maxRetries: 3,
  } as ScanConfig;
}

function fixtureLoggingConfig(): LoggingConfig {
  return {
    level: 'info',
    format: 'json',
    filterIncludes: '',
    filterExcludes: '',
  } as LoggingConfig;
}

function fixtureServerConfig(): ServerConfig {
  return { port: 3000 } as ServerConfig;
}

function fixtureApiAuthConfig(): ApiAuthConfig {
  return {
    adminPassword: 'super-secret-admin-password',
    jwtSecret: 'super-secret-jwt-signing-key',
    adminTokenTtlSeconds: 3600,
    mailboxTokenTtlSeconds: 3600,
  } as ApiAuthConfig;
}

function fixtureMailboxConnectionConfig(): MailboxConnectionConfig {
  return {
    id: 'owner@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapUser: 'owner@example.com',
    imapPassword: 'super-secret-imap-password',
    imapTls: true,
    imapAllowInsecure: false,
    stateFolder: 'INBOX.scanner.state',
  } as MailboxConnectionConfig;
}

function build() {
  const runnerRegistry = {
    getStatus: vi.fn().mockReturnValue({
      mailboxes: [{ mailboxId: 'owner@example.com', state: 'running' }],
      ai: { reason: null, count: 0, lastError: null, lastAt: null },
    }),
  };
  const healthReport: HealthReport = {
    status: 'up',
    rspamd: 'reachable',
    ai: { reason: null, count: 0, lastError: null, lastAt: null },
    mailboxes: [],
  };
  const healthService = {
    liveness: vi.fn(),
    health: vi.fn().mockResolvedValue(healthReport),
  };

  const controller = new AdminController(
    runnerRegistry as unknown as RunnerRegistry,
    healthService as unknown as HealthService,
    fixtureRspamdConfig(),
    fixtureAiConfig(),
    fixtureScanConfig(),
    fixtureLoggingConfig(),
    fixtureServerConfig(),
    fixtureApiAuthConfig(),
    fixtureMailboxConnectionConfig(),
  );

  return { controller, runnerRegistry, healthService, healthReport };
}

const SECRET_VALUES = [
  'super-secret-rspamd-password',
  'super-secret-ai-key',
  'super-secret-admin-password',
  'super-secret-jwt-signing-key',
  'super-secret-imap-password',
];

describe('AdminController', () => {
  test('GET /admin/mailboxes delegates to RunnerRegistry.getStatus().mailboxes', () => {
    const { controller, runnerRegistry } = build();

    const result = controller.getMailboxes();

    expect(runnerRegistry.getStatus).toHaveBeenCalledWith();
    expect(result).toEqual([{ mailboxId: 'owner@example.com', state: 'running' }]);
  });

  test('GET /admin/health delegates to HealthService.health()', async () => {
    const { controller, healthService, healthReport } = build();

    const result = await controller.getHealth();

    expect(healthService.health).toHaveBeenCalledWith();
    expect(result).toEqual(healthReport);
  });

  test('GET /admin/settings never includes any secret field', () => {
    const { controller } = build();

    const settings: AdminSettings = controller.getSettings();
    const serialized = JSON.stringify(settings);

    for (const secret of SECRET_VALUES) {
      expect(serialized).not.toContain(secret);
    }
    expect(settings).not.toHaveProperty('rspamd.password');
    expect(settings).not.toHaveProperty('ai.apiKey');
    expect(settings).not.toHaveProperty('apiAuth.adminPassword');
    expect(settings).not.toHaveProperty('apiAuth.jwtSecret');
    expect(settings).not.toHaveProperty('mailbox.imapPassword');
  });

  test('GET /admin/settings returns the expected non-secret fields', () => {
    const { controller } = build();

    const settings = controller.getSettings();

    expect(settings).toEqual({
      rspamd: { url: 'http://rspamd:11333', timeoutMs: 5000, envelopeTrustedHops: 1 },
      ai: {
        enabled: true,
        baseUrl: 'https://api.openai.com',
        model: 'gpt-4',
        timeoutMs: 30000,
        maxRetries: 3,
        concurrency: 2,
        maxInputTokens: 1000,
        maxOutputTokens: 200,
        failureAlertThreshold: 5,
      },
      scan: {
        scanIntervalSeconds: 300,
        batchScanSize: 50,
        batchProcessSize: 10,
        maxRetries: 3,
      },
      logging: { level: 'info', format: 'json', filterIncludes: '', filterExcludes: '' },
      server: { port: 3000 },
      apiAuth: { adminTokenTtlSeconds: 3600, mailboxTokenTtlSeconds: 3600 },
      mailbox: {
        id: 'owner@example.com',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'owner@example.com',
        imapTls: true,
        imapAllowInsecure: false,
        stateFolder: 'INBOX.scanner.state',
      },
    });
  });
});
