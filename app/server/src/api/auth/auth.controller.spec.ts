import { describe, test, expect, vi } from 'vitest';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';

describe('AuthController', () => {
  function fixtureAuthService(): { [K in keyof AuthService]: ReturnType<typeof vi.fn> } {
    return {
      login: vi.fn().mockReturnValue({ token: 'admin-token' }),
      exchangeForMailboxToken: vi.fn().mockReturnValue({ token: 'mailbox-token' }),
    } as unknown as { [K in keyof AuthService]: ReturnType<typeof vi.fn> };
  }

  test('login delegates to AuthService.login with the parsed password and returns its result', () => {
    const authService = fixtureAuthService();
    const controller = new AuthController(authService as unknown as AuthService);

    const result = controller.login({ password: 'correct-password' });

    expect(authService.login).toHaveBeenCalledWith('correct-password');
    expect(result).toEqual({ token: 'admin-token' });
  });

  test('exchangeForMailboxToken delegates to AuthService with the route mailboxId and returns its result', () => {
    const authService = fixtureAuthService();
    const controller = new AuthController(authService as unknown as AuthService);

    const result = controller.exchangeForMailboxToken('owner@example.com');

    expect(authService.exchangeForMailboxToken).toHaveBeenCalledWith(
      'owner@example.com'
    );
    expect(result).toEqual({ token: 'mailbox-token' });
  });
});
