import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiAuthConfig } from '../../config/app-config.js';
import { MailboxRepository } from '../../infrastructure/mailboxes/mailbox.repository.js';
import type { AdminTokenPayload, MailboxTokenPayload } from '../common/token.js';

/**
 * Constant-time string comparison (design.md D3): guards a login attempt
 * against a timing oracle by always running `timingSafeEqual` over a pair
 * of equal-length buffers - an unequal-length `candidate` is compared
 * against a same-length random buffer instead of short-circuiting on
 * `.length`, so the comparison itself never takes an observably different
 * path (and therefore an observably different amount of time) based on the
 * supplied password's length.
 */
function constantTimeEquals(expected: string, candidate: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const candidateBuffer = Buffer.from(candidate);

  if (expectedBuffer.length !== candidateBuffer.length) {
    timingSafeEqual(expectedBuffer, randomBytes(expectedBuffer.length));
    return false;
  }

  return timingSafeEqual(expectedBuffer, candidateBuffer);
}

/**
 * Issues and exchanges the two token types this server signs (design.md D3,
 * the `server/api-auth` spec): `login` checks the supplied password against
 * the one configured admin password and signs an admin-scope token on
 * success; `exchangeForMailboxToken` checks the requested mailbox id
 * against `MailboxRepository.findAll()` and signs a mailbox-scope token for
 * it. Both paths sign through the same `JwtService` (secret comes from
 * `ApiAuthConfig.jwtSecret` via `AuthModule`'s `JwtModule.registerAsync`),
 * with each token type's own configured TTL.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly config: ApiAuthConfig,
    private readonly jwtService: JwtService,
    private readonly mailboxRepository: MailboxRepository
  ) {}

  login(password: string): { token: string } {
    if (!constantTimeEquals(this.config.adminPassword, password)) {
      throw new UnauthorizedException('Invalid password');
    }

    const payload: AdminTokenPayload = { sub: 'admin', scope: 'admin' };
    const token = this.jwtService.sign(payload, {
      expiresIn: this.config.adminTokenTtlSeconds,
    });

    return { token };
  }

  exchangeForMailboxToken(mailboxId: string): { token: string } {
    const known = this.mailboxRepository
      .findAll()
      .some(mailbox => mailbox.id === mailboxId);

    if (!known) {
      throw new NotFoundException(`Unknown mailbox: ${mailboxId}`);
    }

    const payload: MailboxTokenPayload = {
      sub: mailboxId,
      scope: 'mailbox',
      mailboxId,
    };
    const token = this.jwtService.sign(payload, {
      expiresIn: this.config.mailboxTokenTtlSeconds,
    });

    return { token };
  }
}
