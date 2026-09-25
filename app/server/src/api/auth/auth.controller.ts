import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { loginSchema, type LoginBody } from './login.schema.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminGuard } from '../common/guards/admin.guard.js';

/**
 * The two routes the `server/api-auth` spec describes (design.md D3):
 * `POST /auth/login` is unguarded (it's how a caller gets an admin token in
 * the first place) but body-validated through `ZodValidationPipe`;
 * `POST /auth/mailboxes/:mailboxId/token` requires `AdminGuard`, so a
 * mailbox token presented here is rejected before `AuthService` ever runs -
 * satisfying "a mailbox token cannot obtain another mailbox's token".
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body(new ZodValidationPipe(loginSchema)) body: LoginBody) {
    return this.authService.login(body.password);
  }

  @Post('mailboxes/:mailboxId/token')
  @UseGuards(AdminGuard)
  exchangeForMailboxToken(@Param('mailboxId') mailboxId: string) {
    return this.authService.exchangeForMailboxToken(mailboxId);
  }
}
