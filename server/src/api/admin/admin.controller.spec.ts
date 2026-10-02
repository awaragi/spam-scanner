import { describe, test, expect, vi } from 'vitest';
import type { Response } from 'express';
import { AdminController, type AdminSettings } from './admin.controller.js';
import type { RunnerRegistry } from '../../runtime/runner-registry.js';
import type { AccountAdminService } from '../../application/accounts/account-admin.service.js';
import type { HealthService } from '../health/health.service.js';
import {
  AiConfig,
  ApiAuthConfig,
  LoggingConfig,
  RspamdConfig,
  ScanConfig,
  ServerConfig,
} from '../../config/app-config.js';
import { PreconditionRequiredException } from '../common/http-exceptions.js';

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

function fixtureResponse(): Response {
  return { setHeader: vi.fn() } as unknown as Response;
}

function build(
  runnerRegistry: Partial<RunnerRegistry> = {},
  accountAdminService: Partial<AccountAdminService> = {},
) {
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
    enableMailbox: vi.fn(),
    disableMailbox: vi.fn().mockResolvedValue(undefined),
    ...runnerRegistry,
  };

  const accountAdmin = {
    setEnabled: vi.fn().mockResolvedValue({
      listing: { version: 2, accounts: [] },
      mailbox: { id: 'second@example.com' },
    }),
    ...accountAdminService,
  };

  const controller = new AdminController(
    registry as RunnerRegistry,
    accountAdmin as unknown as AccountAdminService,
    {} as HealthService,
    fixtureRspamdConfig(),
    fixtureAiConfig(),
    fixtureScanConfig(),
    fixtureLoggingConfig(),
    fixtureServerConfig(),
    fixtureApiAuthConfig(),
  );

  return { controller, accountAdmin, registry };
}

const SECRET_VALUES = [
  'super-secret-rspamd-password',
  'super-secret-ai-key',
  'super-secret-admin-password',
  'super-secret-jwt-signing-key',
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

  describe('PUT /admin/mailboxes/:id/enabled', () => {
    test('rejects without an If-Match header, before AccountAdminService runs', async () => {
      const { controller, accountAdmin } = build();
      const res = fixtureResponse();

      await expect(
        controller.setMailboxEnabled(
          'second@example.com',
          { enabled: true },
          undefined,
          res,
        ),
      ).rejects.toThrow(PreconditionRequiredException);
      expect(accountAdmin.setEnabled).not.toHaveBeenCalled();
    });

    test('delegates to AccountAdminService.setEnabled then syncs the runner registry', async () => {
      const { controller, accountAdmin, registry } = build();
      const res = fixtureResponse();

      const result = await controller.setMailboxEnabled(
        'second@example.com',
        { enabled: true },
        '"1"',
        res,
      );

      expect(accountAdmin.setEnabled).toHaveBeenCalledWith(
        'second@example.com',
        true,
        1,
      );
      expect(registry.enableMailbox).toHaveBeenCalledWith('second@example.com');
      expect(result).toEqual({ updated: true });
      expect(res.setHeader).toHaveBeenCalledWith('ETag', '"2"');
    });
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
  });

  test('GET /admin/settings omits mailbox connection fields and account lists entirely', () => {
    const { controller } = build();

    const settings = controller.getSettings() as unknown as Record<
      string,
      unknown
    >;

    expect(settings).not.toHaveProperty('mailboxes');
    expect(settings).not.toHaveProperty('accounts');
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
    });
  });
});
