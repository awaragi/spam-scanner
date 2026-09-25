import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RunnerRegistry } from '../../runtime/runner-registry.js';
import type { MailboxRunnerStatus } from '../../runtime/mailbox-runner.js';
import type { MailboxSettings } from '../../config/mailbox-settings.defaults.js';
import {
  MailboxAdminService,
  type SenderListKind,
} from '../../application/mailbox-admin/mailbox-admin.service.js';
import type { ScannerState } from '../../domain/state/state-format.js';
import { MailboxScopeGuard } from '../common/guards/mailbox-scope.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { resolveJobName } from './job-name.js';
import {
  settingsUpdateSchema,
  type SettingsUpdateBody,
} from './settings-update.schema.js';
import { listReplaceSchema, type ListReplaceBody } from './list-replace.schema.js';

const LIST_KINDS: readonly SenderListKind[] = ['whitelist', 'blacklist'];

function parseListKind(kind: string): SenderListKind {
  if (!LIST_KINDS.includes(kind as SenderListKind)) {
    throw new BadRequestException(`Unknown list kind: ${kind}`);
  }
  return kind as SenderListKind;
}

/**
 * Translates the registry's plain `Error('Unknown mailbox: ...')` (design.md
 * D10) to a `NotFoundException` a Nest exception filter can turn into a 404.
 * `MailboxAdminService`'s own methods already throw `NotFoundException`
 * directly, so only the synchronous `RunnerRegistry` lookups
 * (`getMailboxStatus`/`getMailboxSettings`) need this wrapper.
 */
function withUnknownMailboxAsNotFound<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unknown mailbox:')) {
      throw new NotFoundException(error.message);
    }
    throw error;
  }
}

/**
 * Same translation as `withUnknownMailboxAsNotFound`, for the `async`
 * `RunnerRegistry` methods (`triggerNow`/`triggerInitFolders`/
 * `updateSettings`), which reject rather than throw synchronously.
 */
async function withUnknownMailboxAsNotFoundAsync<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Unknown mailbox:')) {
      throw new NotFoundException(error.message);
    }
    throw error;
  }
}

/**
 * The mailbox-scoped routes the `server/mailbox-api` spec describes
 * (design.md D6, D7, D10): job triggers, settings read/update, scanner state
 * read/reset, and sender-list read/replace/export/import, all under
 * `mailboxes/:mailboxId` and gated by `MailboxScopeGuard` so a token only
 * ever reaches its own mailbox's routes.
 */
@ApiTags('mailbox')
@ApiBearerAuth('bearer')
@Controller('mailboxes/:mailboxId')
@UseGuards(MailboxScopeGuard)
export class MailboxController {
  constructor(
    private readonly runnerRegistry: RunnerRegistry,
    private readonly mailboxAdminService: MailboxAdminService,
  ) {}

  @Post('jobs/:job/trigger')
  async triggerJob(
    @Param('mailboxId') mailboxId: string,
    @Param('job') job: string,
  ): Promise<{ triggered: true }> {
    const resolved = resolveJobName(job);
    if (resolved === 'unknown') {
      throw new BadRequestException(`Unknown job: ${job}`);
    }

    await withUnknownMailboxAsNotFoundAsync(() =>
      resolved.kind === 'initFolders'
        ? this.runnerRegistry.triggerInitFolders(mailboxId)
        : this.runnerRegistry.triggerNow(mailboxId, resolved.jobName),
    );

    return { triggered: true };
  }

  @Get('status')
  getStatus(@Param('mailboxId') mailboxId: string): MailboxRunnerStatus {
    return withUnknownMailboxAsNotFound(() =>
      this.runnerRegistry.getMailboxStatus(mailboxId),
    );
  }

  @Get('settings')
  getSettings(@Param('mailboxId') mailboxId: string): MailboxSettings {
    return withUnknownMailboxAsNotFound(() =>
      this.runnerRegistry.getMailboxSettings(mailboxId),
    );
  }

  @Put('settings')
  async updateSettings(
    @Param('mailboxId') mailboxId: string,
    @Body(new ZodValidationPipe(settingsUpdateSchema))
    body: SettingsUpdateBody,
  ): Promise<{ updated: true }> {
    await withUnknownMailboxAsNotFoundAsync(() =>
      this.runnerRegistry.updateSettings(mailboxId, body),
    );
    return { updated: true };
  }

  @Get('state')
  async getState(
    @Param('mailboxId') mailboxId: string,
  ): Promise<ScannerState | null> {
    return this.mailboxAdminService.readState(mailboxId);
  }

  @Post('state/reset')
  async resetState(
    @Param('mailboxId') mailboxId: string,
  ): Promise<{ reset: true }> {
    await this.mailboxAdminService.resetState(mailboxId);
    return { reset: true };
  }

  @Get('lists/:kind')
  async readList(
    @Param('mailboxId') mailboxId: string,
    @Param('kind') kind: string,
  ): Promise<string[]> {
    return this.mailboxAdminService.readList(mailboxId, parseListKind(kind));
  }

  @Get('lists/:kind/export')
  async exportList(
    @Param('mailboxId') mailboxId: string,
    @Param('kind') kind: string,
  ): Promise<string[]> {
    return this.mailboxAdminService.readList(mailboxId, parseListKind(kind));
  }

  @Put('lists/:kind')
  async replaceList(
    @Param('mailboxId') mailboxId: string,
    @Param('kind') kind: string,
    @Body(new ZodValidationPipe(listReplaceSchema)) addresses: ListReplaceBody,
  ): Promise<{ replaced: true }> {
    await this.mailboxAdminService.replaceList(
      mailboxId,
      parseListKind(kind),
      addresses,
    );
    return { replaced: true };
  }

  @Post('lists/:kind/import')
  async importList(
    @Param('mailboxId') mailboxId: string,
    @Param('kind') kind: string,
    @Body(new ZodValidationPipe(listReplaceSchema)) addresses: ListReplaceBody,
  ): Promise<{ imported: true }> {
    await this.mailboxAdminService.replaceList(
      mailboxId,
      parseListKind(kind),
      addresses,
    );
    return { imported: true };
  }
}
