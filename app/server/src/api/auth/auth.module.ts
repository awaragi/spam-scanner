import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MailboxesModule } from '../../infrastructure/mailboxes/mailboxes.module.js';
import { ApiAuthConfig } from '../../config/app-config.js';
import { AuthService } from './auth.service.js';
import { AuthController } from './auth.controller.js';
import { AdminGuard } from '../common/guards/admin.guard.js';
import { MailboxScopeGuard } from '../common/guards/mailbox-scope.guard.js';

/**
 * Provides `AuthService`/`AuthController` and the one `JwtService` every
 * other guard in `api/` reuses (design.md D2/D9). `JwtModule.registerAsync`
 * reads its signing secret from `ApiAuthConfig` (itself injectable without
 * an explicit import here - `ApiAuthConfig` comes from the global
 * `AppConfigModule`) so the secret is configured in exactly one place.
 * `AdminGuard`/`MailboxScopeGuard` are provided and exported here (not
 * re-declared per-module) since both only depend on the `JwtService` this
 * module already builds - other API modules import `AuthModule` to reuse
 * them rather than constructing their own.
 */
@Module({
  imports: [
    MailboxesModule,
    JwtModule.registerAsync({
      useFactory: (config: ApiAuthConfig) => ({ secret: config.jwtSecret }),
      inject: [ApiAuthConfig],
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AdminGuard, MailboxScopeGuard],
  exports: [JwtModule, AdminGuard, MailboxScopeGuard],
})
export class AuthModule {}
