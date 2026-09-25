import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { verifyBearerToken } from './token.util.js';
import { isAdminTokenPayload } from '../token.js';

/**
 * Gates every admin-scoped route (design.md D4/D10, the "Admin-scoped
 * routes require a valid admin token" requirement): verifies the bearer
 * token (`verifyBearerToken`) and then requires `scope === 'admin'`. Any
 * other outcome - no token, an expired/tampered token, or a valid mailbox
 * token - is `UnauthorizedException`; a mailbox token must never grant
 * admin access.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const payload = verifyBearerToken(request, this.jwtService);

    if (!isAdminTokenPayload(payload)) {
      throw new UnauthorizedException('Admin scope required');
    }

    return true;
  }
}
