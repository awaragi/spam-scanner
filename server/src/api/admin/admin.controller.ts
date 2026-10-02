import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RunnerRegistry } from '../../runtime/runner-registry.js';
import type { MailboxRunnerStatus } from '../../runtime/mailbox-runner.js';
import { AccountAdminService } from '../../application/accounts/account-admin.service.js';
import {
  AiConfig,
  ApiAuthConfig,
  LoggingConfig,
  RspamdConfig,
  ScanConfig,
  ServerConfig,
} from '../../config/app-config.js';
import { HealthService, type HealthReport } from '../health/health.service.js';
import { AdminGuard } from '../common/guards/admin.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { etagFor, requireIfMatchVersion } from '../common/http-exceptions.js';
import {
  mailboxEnabledSchema,
  type MailboxEnabledBody,
} from '../mailbox/mailbox-enabled.schema.js';

/** `GET /admin/settings`'s shape - every non-secret field from every config section. Carries no mailbox/account data (see `/admin/accounts`). */
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
    private readonly accountAdminService: AccountAdminService,
    private readonly healthService: HealthService,
    private readonly rspamdConfig: RspamdConfig,
    private readonly aiConfig: AiConfig,
    private readonly scanConfig: ScanConfig,
    private readonly loggingConfig: LoggingConfig,
    private readonly serverConfig: ServerConfig,
    private readonly apiAuthConfig: ApiAuthConfig,
  ) {}

  @Get('mailboxes')
  getMailboxes(): MailboxRunnerStatus[] {
    return this.runnerRegistry.getStatus().mailboxes;
  }

  /**
   * Persistent enable/disable (`server/mailbox-api`'s "An admin can enable
   * or disable any managed mailbox's runner with persistence" requirement) -
   * `persistent-mailbox-accounts` design.md D4/D6: goes through
   * `AccountAdminService.setEnabled` (IMAP test + versioned store write)
   * before syncing the live `RunnerRegistry`, same `If-Match`/`ETag`
   * precondition as `/admin/accounts`.
   */
  @Put('mailboxes/:mailboxId/enabled')
  async setMailboxEnabled(
    @Param('mailboxId') mailboxId: string,
    @Body(new ZodValidationPipe(mailboxEnabledSchema))
    body: MailboxEnabledBody,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ updated: true }> {
    const expectedVersion = requireIfMatchVersion(ifMatch);
    const { listing } = await this.accountAdminService.setEnabled(
      mailboxId,
      body.enabled,
      expectedVersion,
    );
    // Design.md D4 step 6: enable/disable syncs through the registry's
    // existing enable/disable methods, not a full `updateAccount` replace -
    // only `enabled` changed, so there's no new connection snapshot to
    // swap in.
    if (body.enabled) {
      this.runnerRegistry.enableMailbox(mailboxId);
    } else {
      await this.runnerRegistry.disableMailbox(mailboxId);
    }
    res.setHeader('ETag', etagFor(listing.version));
    return { updated: true };
  }

  @Get('health')
  getHealth(): Promise<HealthReport> {
    return this.healthService.health();
  }

  /**
   * Assembled field-by-field from each injected config section, explicitly
   * omitting every credential/secret (`RspamdConfig.password`,
   * `AiConfig.apiKey`, `ApiAuthConfig.adminPassword`/`jwtSecret`) rather than
   * spreading a section and deleting keys, so a new secret field added to a
   * section later can't silently leak through this endpoint by omission.
   * Carries no mailbox connection fields or account list at all - those are
   * `/admin/accounts`'s job now (`server/mailbox-api`'s "App settings omit
   * mailbox accounts" requirement).
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
    };
  }
}
