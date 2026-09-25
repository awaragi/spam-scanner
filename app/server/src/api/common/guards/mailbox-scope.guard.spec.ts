import { describe, test, expect } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { MailboxScopeGuard } from './mailbox-scope.guard.js';

function fixtureContext(
  authorization: string | undefined,
  params: Record<string, string> = {}
): ExecutionContext {
  const request = { headers: { authorization }, params } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('MailboxScopeGuard', () => {
  const jwtService = new JwtService({ secret: 'mailbox-secret' });

  test('activates when the mailbox token matches the route mailboxId', () => {
    const guard = new MailboxScopeGuard(jwtService);
    const token = jwtService.sign({
      sub: 'owner@example.com',
      scope: 'mailbox',
      mailboxId: 'owner@example.com',
    });

    expect(
      guard.canActivate(
        fixtureContext(`Bearer ${token}`, { mailboxId: 'owner@example.com' })
      )
    ).toBe(true);
  });

  test('throws ForbiddenException when the mailbox token is for a different mailbox', () => {
    const guard = new MailboxScopeGuard(jwtService);
    const token = jwtService.sign({
      sub: 'owner@example.com',
      scope: 'mailbox',
      mailboxId: 'owner@example.com',
    });

    expect(() =>
      guard.canActivate(
        fixtureContext(`Bearer ${token}`, { mailboxId: 'other@example.com' })
      )
    ).toThrow(ForbiddenException);
  });

  test('throws UnauthorizedException for an admin token', () => {
    const guard = new MailboxScopeGuard(jwtService);
    const token = jwtService.sign({ sub: 'admin', scope: 'admin' });

    expect(() =>
      guard.canActivate(
        fixtureContext(`Bearer ${token}`, { mailboxId: 'owner@example.com' })
      )
    ).toThrow(UnauthorizedException);
  });
});
