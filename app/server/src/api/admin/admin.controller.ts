import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RunnerRegistry } from '../../runtime/runner-registry.js';
import type { MailboxRunnerStatus } from '../../runtime/mailbox-runner.js';
import {
  AiConfig,
  ApiAuthConfig,
  LoggingConfig,
  MailboxConnectionConfig,
  RspamdConfig,
  ScanConfig,
  ServerConfig,
} from '../../config/app-config.js';
import { HealthService, type HealthReport } from '../health/health.service.js';
import { AdminGuard } from '../common/guards/admin.guard.js';

/** `GET /admin/settings`'s shape - every non-secret field from every config section. */
export interface AdminSettings {
  rspamd: { url: string; timeoutMs: number; envelopeTrustedHops: number };
  ai: {
    enabled: boolean;
    baseUrl: string;
    model: string;
    timeoutMs: number;
    maxRetries: number;
    concurrency: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    failureAlertThreshold: number;
  };
  scan: {
    scanIntervalSeconds: number;
    batchScanSize: number;
    batchProcessSize: number;
    maxRetries: number;
  };
  logging: {
    level: string;
    format: string;
    filterIncludes: string;
    filterExcludes: string;
  };
  server: { port: number };
  apiAuth: { adminTokenTtlSeconds: number; mailboxTokenTtlSeconds: number };
  mailbox: {
    id: string;
    imapHost: string;
    imapPort: number;
    imapUser: string;
    imapTls: boolean;
    imapAllowInsecure: boolean;
    stateFolder: string;
  };
}

/**
 * The admin-scoped routes the `server/mailbox-api` spec describes
 * (design.md D8, D9, D10): the mailbox list, full health, and non-secret app
 * settings. Every route requires `AdminGuard` - a mailbox token is rejected
 * before any handler runs.
 */
@ApiTags('admin')
@ApiBearerAuth('bearer')
@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly runnerRegistry: RunnerRegistry,
    private readonly healthService: HealthService,
    private readonly rspamdConfig: RspamdConfig,
    private readonly aiConfig: AiConfig,
    private readonly scanConfig: ScanConfig,
    private readonly loggingConfig: LoggingConfig,
    private readonly serverConfig: ServerConfig,
    private readonly apiAuthConfig: ApiAuthConfig,
    private readonly mailboxConnectionConfig: MailboxConnectionConfig,
  ) {}

  @Get('mailboxes')
  getMailboxes(): MailboxRunnerStatus[] {
    return this.runnerRegistry.getStatus().mailboxes;
  }

  @Get('health')
  getHealth(): Promise<HealthReport> {
    return this.healthService.health();
  }

  /**
   * Assembled field-by-field from each injected config section, explicitly
   * omitting every credential/secret (`RspamdConfig.password`,
   * `AiConfig.apiKey`, `ApiAuthConfig.adminPassword`/`jwtSecret`, and any
   * IMAP credential - not read here at all) rather than spreading a section
   * and deleting keys, so a new secret field added to a section later can't
   * silently leak through this endpoint by omission.
   */
  @Get('settings')
  getSettings(): AdminSettings {
    return {
      rspamd: {
        url: this.rspamdConfig.url,
        timeoutMs: this.rspamdConfig.timeoutMs,
        envelopeTrustedHops: this.rspamdConfig.envelopeTrustedHops,
      },
      ai: {
        enabled: this.aiConfig.enabled,
        baseUrl: this.aiConfig.baseUrl,
        model: this.aiConfig.model,
        timeoutMs: this.aiConfig.timeoutMs,
        maxRetries: this.aiConfig.maxRetries,
        concurrency: this.aiConfig.concurrency,
        maxInputTokens: this.aiConfig.maxInputTokens,
        maxOutputTokens: this.aiConfig.maxOutputTokens,
        failureAlertThreshold: this.aiConfig.failureAlertThreshold,
      },
      scan: {
        scanIntervalSeconds: this.scanConfig.scanIntervalSeconds,
        batchScanSize: this.scanConfig.batchScanSize,
        batchProcessSize: this.scanConfig.batchProcessSize,
        maxRetries: this.scanConfig.maxRetries,
      },
      logging: {
        level: this.loggingConfig.level,
        format: this.loggingConfig.format,
        filterIncludes: this.loggingConfig.filterIncludes,
        filterExcludes: this.loggingConfig.filterExcludes,
      },
      server: { port: this.serverConfig.port },
      apiAuth: {
        adminTokenTtlSeconds: this.apiAuthConfig.adminTokenTtlSeconds,
        mailboxTokenTtlSeconds: this.apiAuthConfig.mailboxTokenTtlSeconds,
      },
      mailbox: {
        id: this.mailboxConnectionConfig.id,
        imapHost: this.mailboxConnectionConfig.imapHost,
        imapPort: this.mailboxConnectionConfig.imapPort,
        imapUser: this.mailboxConnectionConfig.imapUser,
        imapTls: this.mailboxConnectionConfig.imapTls,
        imapAllowInsecure: this.mailboxConnectionConfig.imapAllowInsecure,
        stateFolder: this.mailboxConnectionConfig.stateFolder,
      },
    };
  }
}
