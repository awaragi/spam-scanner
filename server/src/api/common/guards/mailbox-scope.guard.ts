import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { verifyBearerToken } from './token.util.js';
import { isMailboxTokenPayload } from '../token.js';

/**
 * Gates every mailbox-scoped route (design.md D4/D10, the "Mailbox-scoped
 * routes require a mailbox token whose id matches the route" requirement):
 * verifies the bearer token, requires `scope === 'mailbox'` (an admin token
 * is the wrong scope entirely - `UnauthorizedException`, not a mismatch),
 * then requires the token's `mailboxId` to match `request.params.mailboxId`
 * (a mismatch is a *valid* token for the wrong resource -
 * `ForbiddenException`, per D10's 401-vs-403 split).
 */
@Injectable()
export class MailboxScopeGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const payload = verifyBearerToken(request, this.jwtService);

    if (!isMailboxTokenPayload(payload)) {
      throw new UnauthorizedException('Mailbox scope required');
    }

    if (payload.mailboxId !== request.params.mailboxId) {
      throw new ForbiddenException('Token is not scoped to this mailbox');
    }

    return true;
  }
}
