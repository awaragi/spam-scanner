const ADMIN_TOKEN_KEY = 'spam-scanner.adminToken';
const MAILBOX_TOKEN_KEY = 'spam-scanner.mailboxToken';
const MAILBOX_ID_KEY = 'spam-scanner.mailboxId';

export function getAdminToken(): string | null {
  return localStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  localStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  localStorage.removeItem(ADMIN_TOKEN_KEY);
}

export function getMailboxToken(): string | null {
  return sessionStorage.getItem(MAILBOX_TOKEN_KEY);
}

export function getMailboxId(): string | null {
  return sessionStorage.getItem(MAILBOX_ID_KEY);
}

export function setMailboxSession(mailboxId: string, token: string): void {
  sessionStorage.setItem(MAILBOX_ID_KEY, mailboxId);
  sessionStorage.setItem(MAILBOX_TOKEN_KEY, token);
}

export function clearMailboxSession(): void {
  sessionStorage.removeItem(MAILBOX_ID_KEY);
  sessionStorage.removeItem(MAILBOX_TOKEN_KEY);
}
