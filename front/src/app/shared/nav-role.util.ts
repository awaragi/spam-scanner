export type NavRole = 'admin' | 'mailbox' | 'none';

export function navRoleForPath(path: string): NavRole {
  if (path.startsWith('/admin')) {
    return 'admin';
  }
  if (path.startsWith('/mailbox/')) {
    return 'mailbox';
  }
  return 'none';
}
