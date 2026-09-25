import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtService } from '@nestjs/jwt';
import type { TokenPayload } from '../token.js';

const BEARER_PREFIX = 'Bearer ';

/**
 * The single token-verification step both guards (`AdminGuard`,
 * `MailboxScopeGuard`) build on (design.md D4): extracts the bearer token
 * from `request`'s `Authorization` header and verifies it with `jwtService`,
 * throwing `UnauthorizedException` for every way a caller can fail to
 * present a usable token - no header, a non-`Bearer` header, or a token
 * that fails verification (expired, tampered, or signed with a different
 * secret). Returns the decoded payload on success, left un-narrowed by
 * `scope` - narrowing that is each guard's own job.
 */
export function verifyBearerToken(
  request: Request,
  jwtService: JwtService
): TokenPayload {
  const header = request.headers.authorization;
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedException('Missing or malformed Authorization header');
  }

  const token = header.slice(BEARER_PREFIX.length);
  try {
    return jwtService.verify<TokenPayload>(token);
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
}
