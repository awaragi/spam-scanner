import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { AdminController } from './admin/admin.controller.js';
import { MailboxController } from './mailbox/mailbox.controller.js';
import { HealthController } from './health/health.controller.js';
import { HealthService } from './health/health.service.js';
import { RuntimeModule } from '../runtime/runtime.module.js';
import { MailboxAdminModule } from '../application/mailbox-admin/mailbox-admin.module.js';
import { RspamdModule } from '../infrastructure/rspamd/rspamd.module.js';
import { AiModule } from '../infrastructure/ai/ai.module.js';

/**
 * The top of the dependency direction (design.md D9): aggregates every
 * controller in `api/` plus the one provider (`HealthService`) that has no
 * module of its own, importing whatever those controllers/`HealthService`
 * need to resolve.
 *
 * - `AuthModule` - already declares `AuthController` itself (a controller
 *   declared in an imported module is active without being re-declared
 *   here - re-declaring it in `ApiModule` too would register a second
 *   instance that can't see `AuthModule`'s own, un-exported `AuthService`),
 *   and provides/exports the `AdminGuard`/`MailboxScopeGuard` that
 *   `AdminController`/`MailboxController` apply via `@UseGuards(...)`.
 * - `RuntimeModule` - `RunnerRegistry`, used directly by `AdminController`/
 *   `MailboxController` and (transitively, through `HealthService`) here.
 * - `MailboxAdminModule` - `MailboxAdminService`, used by
 *   `MailboxController` for scanner-state/sender-list operations.
 * - `RspamdModule`/`AiModule` - `RspamdGateway`/`AiFailureTracker`, both
 *   only needed by `HealthService`.
 *
 * No explicit `MailboxesModule` import: nothing declared directly here
 * injects `MailboxRepository` (it's already pulled in transitively by
 * `AuthModule`/`RuntimeModule`/`MailboxAdminModule`, each of which imports
 * it themselves). Config sections (`RspamdConfig`, `ApiAuthConfig`, ...)
 * come from the global `AppConfigModule` without an explicit import, same
 * as everywhere else in the app.
 */
@Module({
  imports: [AuthModule, RuntimeModule, MailboxAdminModule, RspamdModule, AiModule],
  controllers: [AdminController, MailboxController, HealthController],
  providers: [HealthService],
})
export class ApiModule {}
