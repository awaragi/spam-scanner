import { describe, test, expect, vi } from 'vitest';
import { HealthService } from './health.service.js';
import type { RunnerRegistry, RunnerRegistryStatus } from '../../runtime/runner-registry.js';
import type { AiFailureTracker } from '../../domain/ai/ai-failure-tracker.js';
import type { RspamdGateway } from '../../infrastructure/rspamd/rspamd.gateway.js';
import type { MailboxRunnerStatus, JobStatus, JobName } from '../../runtime/mailbox-runner.js';

function fixtureJobStatus(overrides: Partial<JobStatus> = {}): JobStatus {
  return {
    consecutiveFailures: 0,
    ...overrides,
  };
}

function fixtureMailboxStatus(
  overrides: Partial<MailboxRunnerStatus> = {},
): MailboxRunnerStatus {
  const jobNames: JobName[] = [
    'scan',
    'trainSpam',
    'trainHam',
    'trainWhitelist',
    'trainBlacklist',
  ];
  const jobs = Object.fromEntries(
    jobNames.map((job) => [job, fixtureJobStatus()]),
  ) as Record<JobName, JobStatus>;

  return {
    mailboxId: 'owner@example.com',
    state: 'running',
    mode: 'idle',
    jobs,
    ...overrides,
  };
}

function build(options: {
  status?: RunnerRegistryStatus;
  aiStatus?: ReturnType<AiFailureTracker['status']>;
  pingResult?: boolean;
}) {
  const status: RunnerRegistryStatus = options.status ?? {
    mailboxes: [fixtureMailboxStatus()],
    ai: options.aiStatus ?? {
      reason: null,
      count: 0,
      lastError: null,
      lastAt: null,
    },
  };

  const runnerRegistry = {
    getStatus: vi.fn().mockReturnValue(status),
  };
  const aiFailureTracker = {};
  const rspamdGateway = {
    ping: vi.fn().mockResolvedValue(options.pingResult ?? true),
  };

  const service = new HealthService(
    runnerRegistry as unknown as RunnerRegistry,
    aiFailureTracker as unknown as AiFailureTracker,
    rspamdGateway as unknown as RspamdGateway,
  );

  return { service, runnerRegistry, rspamdGateway };
}

describe('HealthService', () => {
  describe('liveness', () => {
    test('exposes only the up status, nothing privileged', () => {
      const { service } = build({});

      const result = service.liveness();

      expect(result).toEqual({ status: 'up' });
      expect(Object.keys(result)).toEqual(['status']);
    });
  });

  describe('health', () => {
    test('reports rspamd as unreachable when ping resolves false, without throwing', async () => {
      const { service } = build({ pingResult: false });

      const result = await service.health();

      expect(result.rspamd).toBe('unreachable');
      expect(result.status).toBe('up');
    });

    test('reports rspamd as reachable when ping resolves true', async () => {
      const { service } = build({ pingResult: true });

      const result = await service.health();

      expect(result.rspamd).toBe('reachable');
    });

    test('reflects the AI failure status from getStatus()', async () => {
      const aiStatus = {
        reason: 'timeout',
        count: 3,
        lastError: 'boom',
        lastAt: '2026-01-01T00:00:00.000Z',
      };
      const { service } = build({
        status: { mailboxes: [], ai: aiStatus },
      });

      const result = await service.health();

      expect(result.ai).toEqual(aiStatus);
    });

    test('derives each mailbox summary from getStatus(), with age when the last scan succeeded', async () => {
      const lastRunAt = new Date(Date.now() - 5000).toISOString();
      const mailbox = fixtureMailboxStatus({
        mailboxId: 'owner@example.com',
        state: 'degraded',
        mode: 'loop',
        jobs: {
          scan: { consecutiveFailures: 0, lastRunAt, lastResult: 'success' },
          trainSpam: fixtureJobStatus(),
          trainHam: fixtureJobStatus(),
          trainWhitelist: fixtureJobStatus(),
          trainBlacklist: fixtureJobStatus(),
        },
      });
      const { service } = build({
        status: {
          mailboxes: [mailbox],
          ai: { reason: null, count: 0, lastError: null, lastAt: null },
        },
      });

      const result = await service.health();

      expect(result.mailboxes).toHaveLength(1);
      expect(result.mailboxes[0]).toMatchObject({
        mailboxId: 'owner@example.com',
        state: 'degraded',
        mode: 'loop',
      });
      expect(result.mailboxes[0].lastSuccessfulScanAgeMs).toBeGreaterThanOrEqual(
        4000,
      );
    });

    test('reports lastSuccessfulScanAgeMs as null when the last scan did not succeed', async () => {
      const mailbox = fixtureMailboxStatus({
        jobs: {
          scan: {
            consecutiveFailures: 1,
            lastRunAt: new Date().toISOString(),
            lastResult: 'failure',
          },
          trainSpam: fixtureJobStatus(),
          trainHam: fixtureJobStatus(),
          trainWhitelist: fixtureJobStatus(),
          trainBlacklist: fixtureJobStatus(),
        },
      });
      const { service } = build({
        status: {
          mailboxes: [mailbox],
          ai: { reason: null, count: 0, lastError: null, lastAt: null },
        },
      });

      const result = await service.health();

      expect(result.mailboxes[0].lastSuccessfulScanAgeMs).toBeNull();
    });

    test('reports lastSuccessfulScanAgeMs as null when the mailbox has never scanned', async () => {
      const { service } = build({});

      const result = await service.health();

      expect(result.mailboxes[0].lastSuccessfulScanAgeMs).toBeNull();
    });
  });
});
