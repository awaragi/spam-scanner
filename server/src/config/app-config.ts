import { ConfigService } from '@nestjs/config';
import type { AppConfig } from './app-config.schema.js';

/**
 * Every typed config section below is built from this same
 * `ConfigService<AppConfig, true>` - `AppConfig` is the schema's inferred
 * shape, and `true` (`WasValidated`) tells `ConfigService#get` the value is
 * never `undefined`, since `AppConfigSchema` has already validated it once
 * at bootstrap (see `config.module.ts`).
 */
export type AppConfigService = ConfigService<AppConfig, true>;

/** Rspamd connection - shared by every mailbox (see `infrastructure/rspamd`). */
export class RspamdConfig {
  readonly url: string;
  readonly password: string;
  readonly timeoutMs: number;
  readonly envelopeTrustedHops: number;

  constructor(config: AppConfigService) {
    this.url = config.get('RSPAMD_URL', { infer: true });
    this.password = config.get('RSPAMD_PASSWORD', { infer: true });
    this.timeoutMs = config.get('RSPAMD_TIMEOUT_MS', { infer: true });
    this.envelopeTrustedHops = config.get('RSPAMD_ENVELOPE_TRUSTED_HOPS', {
      infer: true,
    });
  }
}

/**
 * The AI provider - global settings only. Per-mailbox AI behavior (the
 * escalation thresholds and the opt-out) lives in
 * `mailbox-settings.defaults.ts` instead.
 */
export class AiConfig {
  readonly enabled: boolean;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  readonly concurrency: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly failureAlertThreshold: number;

  constructor(config: AppConfigService) {
    this.enabled = config.get('AI_ENABLED', { infer: true });
    this.baseUrl = config.get('AI_BASE_URL', { infer: true });
    this.apiKey = config.get('AI_API_KEY', { infer: true });
    this.model = config.get('AI_MODEL', { infer: true });
    this.timeoutMs = config.get('AI_TIMEOUT_MS', { infer: true });
    this.maxRetries = config.get('AI_MAX_RETRIES', { infer: true });
    this.concurrency = config.get('AI_CONCURRENCY', { infer: true });
    this.maxInputTokens = config.get('AI_MAX_INPUT_TOKENS', { infer: true });
    this.maxOutputTokens = config.get('AI_MAX_OUTPUT_TOKENS', { infer: true });
    this.failureAlertThreshold = config.get('AI_FAILURE_ALERT_THRESHOLD', {
      infer: true,
    });
  }
}

/** Scan/train cadence and batch sizes - global for now (see `runtime/`). */
export class ScanConfig {
  readonly scanIntervalSeconds: number;
  readonly batchScanSize: number;
  readonly batchProcessSize: number;
  readonly maxRetries: number;

  constructor(config: AppConfigService) {
    this.scanIntervalSeconds = config.get('SCAN_INTERVAL', { infer: true });
    this.batchScanSize = config.get('BATCH_SCAN_SIZE', { infer: true });
    this.batchProcessSize = config.get('BATCH_PROCESS_SIZE', { infer: true });
    this.maxRetries = config.get('MAX_RETRIES', { infer: true });
  }
}

/**
 * Logging - consumed by `logging/logging.module.ts`, which is responsible
 * for the tolerant fallback behavior (case-insensitive, invalid falls back
 * to "info"/"json") - this section only exposes the raw configured strings.
 */
export class LoggingConfig {
  readonly level: string;
  readonly format: string;
  readonly filterIncludes: string;
  readonly filterExcludes: string;

  constructor(config: AppConfigService) {
    this.level = config.get('LOG_LEVEL', { infer: true });
    this.format = config.get('LOG_FORMAT', { infer: true });
    this.filterIncludes = config.get('LOG_FILTER_INCLUDES', { infer: true });
    this.filterExcludes = config.get('LOG_FILTER_EXCLUDES', { infer: true });
  }
}

/** The HTTP server, wired up in `main.ts` (task 7.2). */
export class ServerConfig {
  readonly port: number;

  constructor(config: AppConfigService) {
    this.port = config.get('PORT', { infer: true });
  }
}

/**
 * HTTP API auth - one admin password and one JWT signing secret, plus each
 * token type's TTL (see design.md D1). Consumed by `api/auth/auth.service.ts`
 * and `JwtModule.registerAsync`'s factory.
 */
export class ApiAuthConfig {
  readonly adminPassword: string;
  readonly jwtSecret: string;
  readonly adminTokenTtlSeconds: number;
  readonly mailboxTokenTtlSeconds: number;

  constructor(config: AppConfigService) {
    this.adminPassword = config.get('API_ADMIN_PASSWORD', { infer: true });
    this.jwtSecret = config.get('API_JWT_SECRET', { infer: true });
    this.adminTokenTtlSeconds = config.get('API_ADMIN_TOKEN_TTL', {
      infer: true,
    });
    this.mailboxTokenTtlSeconds = config.get('API_MAILBOX_TOKEN_TTL', {
      infer: true,
    });
  }
}

/**
 * The one mailbox's connection info (see the `server/mailbox-registry`
 * capability) - `MAILBOX_` env keys are a temporary env-backed registry, not
 * app settings (see design.md D5).
 */
export class MailboxConnectionConfig {
  readonly id: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapUser: string;
  readonly imapPassword: string;
  readonly imapTls: boolean;
  readonly imapAllowInsecure: boolean;
  readonly stateFolder: string;

  constructor(config: AppConfigService) {
    this.id = config.get('MAILBOX_ID', { infer: true });
    this.imapHost = config.get('MAILBOX_IMAP_HOST', { infer: true });
    this.imapPort = config.get('MAILBOX_IMAP_PORT', { infer: true });
    this.imapUser = config.get('MAILBOX_IMAP_USER', { infer: true });
    this.imapPassword = config.get('MAILBOX_IMAP_PASSWORD', { infer: true });
    this.imapTls = config.get('MAILBOX_IMAP_TLS', { infer: true });
    this.imapAllowInsecure = config.get('MAILBOX_IMAP_ALLOW_INSECURE', {
      infer: true,
    });
    this.stateFolder = config.get('MAILBOX_STATE_FOLDER', { infer: true });
  }
}
