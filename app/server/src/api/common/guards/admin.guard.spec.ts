import { describe, test, expect } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { AdminGuard } from './admin.guard.js';

function fixtureContext(authorization?: string): ExecutionContext {
  const request = { headers: { authorization }, params: {} } as unknown as Request;
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AdminGuard', () => {
  const jwtService = new JwtService({ secret: 'admin-secret' });

  test('activates for a valid admin token', () => {
    const guard = new AdminGuard(jwtService);
    const token = jwtService.sign({ sub: 'admin', scope: 'admin' });

    expect(guard.canActivate(fixtureContext(`Bearer ${token}`))).toBe(true);
  });

  test('throws UnauthorizedException for a mailbox token', () => {
    const guard = new AdminGuard(jwtService);
    const token = jwtService.sign({
      sub: 'owner@example.com',
      scope: 'mailbox',
      mailboxId: 'owner@example.com',
    });

    expect(() => guard.canActivate(fixtureContext(`Bearer ${token}`))).toThrow(
      UnauthorizedException
    );
  });

  test('throws UnauthorizedException for a missing token', () => {
    const guard = new AdminGuard(jwtService);

    expect(() => guard.canActivate(fixtureContext(undefined))).toThrow(
      UnauthorizedException
    );
  });

  test('throws UnauthorizedException for an expired token', () => {
    const guard = new AdminGuard(jwtService);
    const token = jwtService.sign(
      { sub: 'admin', scope: 'admin' },
      { expiresIn: -1 }
    );

    expect(() => guard.canActivate(fixtureContext(`Bearer ${token}`))).toThrow(
      UnauthorizedException
    );
  });
});
