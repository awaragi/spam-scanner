import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';

const ORIGINAL_ENV = { ...process.env };

/**
 * `AuthModule`'s `JwtModule.registerAsync` injects `ApiAuthConfig`, which
 * comes from the global `AppConfigModule` - so, like
 * `config/config.module.spec.ts`, this test needs `AppConfigModule` in the
 * testing module's imports and a fixture env set before either module is
 * imported (`ConfigModule.forRoot()` reads `process.env` at import time).
 */
async function loadModules() {
  vi.resetModules();
  const [{ AuthModule }, { AppConfigModule }] = await Promise.all([
    import('./auth.module.js'),
    import('../../config/config.module.js'),
  ]);
  return { AuthModule, AppConfigModule };
}

describe('AuthModule', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('resolves AuthService from a fixture env', async () => {
    Object.assign(process.env, {
      MAILBOX_ID: 'owner@example.com',
      MAILBOX_IMAP_HOST: 'imap.example.com',
      MAILBOX_IMAP_USER: 'owner@example.com',
      MAILBOX_IMAP_PASSWORD: 'secret',
      MAILBOX_STATE_FOLDER: 'INBOX.scanner.state',
      API_ADMIN_PASSWORD: 'admin-secret',
      API_JWT_SECRET: 'jwt-secret',
    });

    const { AuthModule, AppConfigModule } = await loadModules();
    const { AuthService } = await import('./auth.service.js');

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, AuthModule],
    }).compile();

    try {
      expect(moduleRef.get(AuthService)).toBeInstanceOf(AuthService);
    } finally {
      await moduleRef.close();
    }
  });
});
