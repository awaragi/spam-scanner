import { describe, expect, it } from 'vitest';
import { navRoleForPath } from './nav-role.util';

describe('navRoleForPath', () => {
  it('maps /admin paths to the admin role', () => {
    expect(navRoleForPath('/admin')).toBe('admin');
  });

  it('maps /mailbox/:id paths to the mailbox role', () => {
    expect(navRoleForPath('/mailbox/user@example.com')).toBe('mailbox');
  });

  it('maps /login to none', () => {
    expect(navRoleForPath('/login')).toBe('none');
  });

  it('maps an unmatched path to none', () => {
    expect(navRoleForPath('/')).toBe('none');
  });
});
