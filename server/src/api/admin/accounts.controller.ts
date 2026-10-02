import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AccountAdminService } from '../../application/accounts/account-admin.service.js';
import type { AccountListing } from '../../application/accounts/account-admin.dto.js';
import { RunnerRegistry } from '../../runtime/runner-registry.js';
import { AdminGuard } from '../common/guards/admin.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { etagFor, requireIfMatchVersion } from '../common/http-exceptions.js';
import {
  createAccountSchema,
  updateAccountSchema,
  type CreateAccountBody,
  type UpdateAccountBody,
} from './account-body.schema.js';

/**
 * `/admin/accounts` CRUD - `server/mailbox-api`'s "An admin can list and
 * manage mailbox accounts" requirement, implementing design.md D4's
 * mutation pipeline and D3's `If-Match`/`ETag` optimistic locking.
 *
 * Each mutating handler calls `AccountAdminService` first (duplicate-id
 * check, IMAP test, versioned store write - see that service's own doc
 * comment for why it, not this controller, owns that pipeline) and only
 * then syncs the live `RunnerRegistry` - this controller is the one place
 * both `application/accounts` and `runtime/` are in scope together.
 */
@ApiTags('admin')
@ApiBearerAuth('bearer')
@Controller('admin/accounts')
@UseGuards(AdminGuard)
export class AccountsController {
  constructor(
    private readonly accountAdminService: AccountAdminService,
    private readonly runnerRegistry: RunnerRegistry,
  ) {}

  @Get()
  async list(
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountListing> {
    const listing = await this.accountAdminService.list();
    res.setHeader('ETag', etagFor(listing.version));
    return listing;
  }

  @Post()
  async create(
    @Body(new ZodValidationPipe(createAccountSchema)) body: CreateAccountBody,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountListing> {
    const expectedVersion = requireIfMatchVersion(ifMatch);
    const { listing, mailbox } = await this.accountAdminService.create(
      body,
      expectedVersion,
    );
    this.runnerRegistry.registerAccount(mailbox);
    res.setHeader('ETag', etagFor(listing.version));
    return listing;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateAccountSchema)) body: UpdateAccountBody,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountListing> {
    const expectedVersion = requireIfMatchVersion(ifMatch);
    const { listing, mailbox } = await this.accountAdminService.update(
      id,
      body,
      expectedVersion,
    );
    await this.runnerRegistry.updateAccount(mailbox);
    res.setHeader('ETag', etagFor(listing.version));
    return listing;
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AccountListing> {
    const expectedVersion = requireIfMatchVersion(ifMatch);
    const listing = await this.accountAdminService.delete(id, expectedVersion);
    await this.runnerRegistry.removeAccount(id);
    res.setHeader('ETag', etagFor(listing.version));
    return listing;
  }
}
