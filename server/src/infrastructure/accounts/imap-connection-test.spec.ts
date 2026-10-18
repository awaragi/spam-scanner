import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockNewClient, mockSafeLogout } = vi.hoisted(() => ({
  mockNewClient: vi.fn(),
  mockSafeLogout: vi.fn(),
}));

vi.mock('../imap/imap-connection.factory.js', () => ({
  newClient: mockNewClient,
  safeLogout: mockSafeLogout,
}));

import { testImapConnection } from './imap-connection-test.js';

const CONNECTION = {
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapUser: 'owner@example.com',
  imapPassword: 'secret',
  imapTls: true,
  imapAllowInsecure: false,
};

describe('testImapConnection', () => {
  beforeEach(() => {
    mockNewClient.mockReset();
    mockSafeLogout.mockReset().mockResolvedValue(undefined);
  });

  test('connects and logs out on success', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const imap = { connect };
    mockNewClient.mockReturnValue(imap);

    await testImapConnection(CONNECTION);

    expect(mockNewClient).toHaveBeenCalledWith(CONNECTION, undefined);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(mockSafeLogout).toHaveBeenCalledWith(imap, undefined);
  });

  test('propagates a connect failure, after still logging out in finally', async () => {
    const connect = vi.fn().mockRejectedValue(new Error('connect refused'));
    const imap = { connect };
    mockNewClient.mockReturnValue(imap);

    await expect(testImapConnection(CONNECTION)).rejects.toThrow(
      'connect refused',
    );
    expect(mockSafeLogout).toHaveBeenCalledWith(imap, undefined);
  });

  test('never calls safeLogout before connect resolves/rejects', async () => {
    let logoutCalledDuringConnect = false;
    const connect = vi.fn().mockImplementation(async () => {
      logoutCalledDuringConnect = mockSafeLogout.mock.calls.length > 0;
    });
    mockNewClient.mockReturnValue({ connect });

    await testImapConnection(CONNECTION);

    expect(logoutCalledDuringConnect).toBe(false);
  });
});
