import { Module } from '@nestjs/common';
import { AccountsModule as InfrastructureAccountsModule } from '../../infrastructure/accounts/accounts.module.js';
import { AccountAdminService } from './account-admin.service.js';

/**
 * Provides `AccountAdminService`, the account mutation pipeline
 * (`persistent-mailbox-accounts` design.md D4). `AccountStore` comes from
 * the infrastructure-layer `AccountsModule`; `PinoLogger` comes from
 * nestjs-pino's own global `LoggerModule` without an explicit import here.
 */
@Module({
  imports: [InfrastructureAccountsModule],
  providers: [AccountAdminService],
  exports: [AccountAdminService],
})
export class AccountsModule {}
