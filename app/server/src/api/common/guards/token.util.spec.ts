import { describe, test, expect } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { verifyBearerToken } from './token.util.js';
import type { AdminTokenPayload } from '../token.js';

function fixtureRequest(authorization?: string): Request {
  return { headers: { authorization } } as unknown as Request;
}

describe('verifyBearerToken', () => {
  const jwtService = new JwtService({ secret: 'correct-secret' });

  test('throws UnauthorizedException when the Authorization header is missing', () => {
    expect(() => verifyBearerToken(fixtureRequest(undefined), jwtService)).toThrow(
      UnauthorizedException
    );
  });

  test('throws UnauthorizedException when the header is not a Bearer token', () => {
    expect(() =>
      verifyBearerToken(fixtureRequest('Basic dXNlcjpwYXNz'), jwtService)
    ).toThrow(UnauthorizedException);
  });

  test('throws UnauthorizedException for a token signed with a different secret', () => {
    const otherJwtService = new JwtService({ secret: 'wrong-secret' });
    const token = otherJwtService.sign({ sub: 'admin', scope: 'admin' });

    expect(() =>
      verifyBearerToken(fixtureRequest(`Bearer ${token}`), jwtService)
    ).toThrow(UnauthorizedException);
  });

  test('returns the decoded payload for a valid token', () => {
    const payload: AdminTokenPayload = { sub: 'admin', scope: 'admin' };
    const token = jwtService.sign(payload);

    const decoded = verifyBearerToken(fixtureRequest(`Bearer ${token}`), jwtService);

    expect(decoded.sub).toBe('admin');
    expect(decoded.scope).toBe('admin');
  });
});
