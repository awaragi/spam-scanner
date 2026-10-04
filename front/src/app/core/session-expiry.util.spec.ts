import { describe, expect, it } from 'vitest';
import { isSessionExpiredResponse } from './session-expiry.util';

describe('isSessionExpiredResponse', () => {
  it('is true for a 401 on an ordinary API call', () => {
    expect(isSessionExpiredResponse('/api/admin/accounts', 401)).toBe(true);
    expect(isSessionExpiredResponse('/api/mailboxes/x/status', 401)).toBe(true);
  });

  it('is true for a 401 on the mailbox-token exchange', () => {
    expect(isSessionExpiredResponse('/api/auth/mailboxes/x/token', 401)).toBe(true);
  });

  it('is false for a 401 on login itself - that is a wrong-password form error', () => {
    expect(isSessionExpiredResponse('/api/auth/login', 401)).toBe(false);
  });

  it('is false for any non-401 status', () => {
    expect(isSessionExpiredResponse('/api/admin/accounts', 403)).toBe(false);
    expect(isSessionExpiredResponse('/api/admin/accounts', 500)).toBe(false);
    expect(isSessionExpiredResponse('/api/admin/accounts', 404)).toBe(false);
  });
});
