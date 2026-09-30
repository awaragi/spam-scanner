import { describe, test, expect, vi } from 'vitest';
import { AdminController, type AdminSettings } from './admin.controller.js';
import type { RunnerRegistry } from '../../runtime/runner-registry.js';
import type { HealthService } from '../health/health.service.js';
import {
  AiConfig,
  ApiAuthConfig,
  LoggingConfig,
  MailboxConnectionsConfig,
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

function fixtureMailboxConnectionsConfig(): MailboxConnectionsConfig {
  return {
    mailboxes: [
      {
        id: 'owner@example.com',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'owner@example.com',
        imapPassword: 'super-secret-imap-password',
        imapTls: true,
        imapAllowInsecure: false,
        stateFolder: 'INBOX.scanner.state',
        enabled: true,
      },
      {
        id: 'second@example.com',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'second@example.com',
        imapPassword: 'super-secret-second-imap-password',
        imapTls: true,
        imapAllowInsecure: false,
        stateFolder: 'INBOX.scanner.state',
        enabled: true,
      },
    ],
  } as MailboxConnectionsConfig;
}

function build(runnerRegistry: Partial<RunnerRegistry> = {}) {
  const registry = {
    getStatus: () => ({
      mailboxes: [
        {
          mailboxId: 'owner@example.com',
          enabled: true,
          state: 'running',
          mode: 'idle',
          jobs: {},
        },
        { mailboxId: 'second@example.com', enabled: false },
      ],
    }),
    enableMailbox: () => undefined,
    disableMailbox: async () => undefined,
    ...runnerRegistry,
  };

  const controller = new AdminController(
    registry as RunnerRegistry,
    {} as HealthService,
    fixtureRspamdConfig(),
    fixtureAiConfig(),
    fixtureScanConfig(),
    fixtureLoggingConfig(),
    fixtureServerConfig(),
    fixtureApiAuthConfig(),
    fixtureMailboxConnectionsConfig(),
  );

  return { controller };
}

const SECRET_VALUES = [
  'super-secret-rspamd-password',
  'super-secret-ai-key',
  'super-secret-admin-password',
  'super-secret-jwt-signing-key',
  'super-secret-imap-password',
  'super-secret-second-imap-password',
];

describe('AdminController', () => {
  test('GET /admin/mailboxes includes enabled and disabled mailboxes', () => {
    const { controller } = build();

    const mailboxes = controller.getMailboxes();

    expect(mailboxes).toHaveLength(2);
    expect(mailboxes[0]).toMatchObject({
      mailboxId: 'owner@example.com',
      enabled: true,
      state: 'running',
    });
    expect(mailboxes[1]).toEqual({
      mailboxId: 'second@example.com',
      enabled: false,
    });
  });

  test('PUT /admin/mailboxes/:id/enabled delegates to RunnerRegistry', async () => {
    const disableMailbox = vi.fn().mockResolvedValue(undefined);
    const enableMailbox = vi.fn();
    const { controller } = build({ disableMailbox, enableMailbox });

    await controller.setMailboxEnabled('second@example.com', { enabled: false });
    expect(disableMailbox).toHaveBeenCalledWith('second@example.com');

    await controller.setMailboxEnabled('second@example.com', { enabled: true });
    expect(enableMailbox).toHaveBeenCalledWith('second@example.com');
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
    expect(settings).not.toHaveProperty('mailboxes.0.imapPassword');
    expect(settings).not.toHaveProperty('mailboxes.1.imapPassword');
  });

  test('GET /admin/settings returns the expected non-secret fields', () => {
    const { controller } = build();

    const settings = controller.getSettings();

    expect(settings).toEqual({
      rspamd: {
        url: 'http://rspamd:11333',
        timeoutMs: 5000,
        envelopeTrustedHops: 1,
      },
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
      logging: {
        level: 'info',
        format: 'json',
        filterIncludes: '',
        filterExcludes: '',
      },
      server: { port: 3000 },
      apiAuth: { adminTokenTtlSeconds: 3600, mailboxTokenTtlSeconds: 3600 },
      mailboxes: [
        {
          id: 'owner@example.com',
          imapHost: 'imap.example.com',
          imapPort: 993,
          imapUser: 'owner@example.com',
          imapTls: true,
          imapAllowInsecure: false,
          stateFolder: 'INBOX.scanner.state',
        },
        {
          id: 'second@example.com',
          imapHost: 'imap.example.com',
          imapPort: 993,
          imapUser: 'second@example.com',
          imapTls: true,
          imapAllowInsecure: false,
          stateFolder: 'INBOX.scanner.state',
        },
      ],
    });
  });
});
