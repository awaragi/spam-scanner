import { describe, test, expect, vi, beforeEach } from 'vitest';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service.js';
import { ApiAuthConfig } from '../../config/app-config.js';
import { MailboxRepository } from '../../infrastructure/mailboxes/mailbox.repository.js';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';

function fixtureMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'owner@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapUser: 'owner@example.com',
    imapPassword: 'secret',
    imapTls: true,
    imapAllowInsecure: false,
    stateFolder: 'INBOX.scanner.state',
    ...overrides,
  };
}

function fixtureConfig(overrides: Partial<ApiAuthConfig> = {}): ApiAuthConfig {
  return {
    adminPassword: 'correct-password',
    jwtSecret: 'jwt-secret',
    adminTokenTtlSeconds: 3600,
    mailboxTokenTtlSeconds: 1800,
    ...overrides,
  } as ApiAuthConfig;
}

describe('AuthService', () => {
  let jwtService: { sign: ReturnType<typeof vi.fn> };
  let mailboxRepository: { findAll: ReturnType<typeof vi.fn> };
  let config: ApiAuthConfig;

  beforeEach(() => {
    jwtService = { sign: vi.fn().mockReturnValue('signed-token') };
    mailboxRepository = { findAll: vi.fn().mockReturnValue([fixtureMailbox()]) };
    config = fixtureConfig();
  });

  function build(): AuthService {
    return new AuthService(
      config,
      jwtService as never,
      mailboxRepository as unknown as MailboxRepository
    );
  }

  describe('login', () => {
    test('signs an admin-scope token with the configured TTL on a correct password', () => {
      const service = build();

      const result = service.login('correct-password');

      expect(result).toEqual({ token: 'signed-token' });
      expect(jwtService.sign).toHaveBeenCalledWith(
        { sub: 'admin', scope: 'admin' },
        { expiresIn: 3600 }
      );
    });

    test('throws UnauthorizedException and signs nothing on a wrong password', () => {
      const service = build();

      expect(() => service.login('wrong-password')).toThrow(
        UnauthorizedException
      );
      expect(jwtService.sign).not.toHaveBeenCalled();
    });

    test('throws UnauthorizedException without signing when the password has a different length', () => {
      const service = build();

      expect(() => service.login('short')).toThrow(UnauthorizedException);
      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });

  describe('exchangeForMailboxToken', () => {
    test('signs a mailbox-scope token carrying the mailboxId for a known mailbox', () => {
      const service = build();

      const result = service.exchangeForMailboxToken('owner@example.com');

      expect(result).toEqual({ token: 'signed-token' });
      expect(jwtService.sign).toHaveBeenCalledWith(
        {
          sub: 'owner@example.com',
          scope: 'mailbox',
          mailboxId: 'owner@example.com',
        },
        { expiresIn: 1800 }
      );
    });

    test('throws NotFoundException for an unknown mailbox id', () => {
      const service = build();

      expect(() =>
        service.exchangeForMailboxToken('unknown@example.com')
      ).toThrow(NotFoundException);
      expect(jwtService.sign).not.toHaveBeenCalled();
    });
  });
});
