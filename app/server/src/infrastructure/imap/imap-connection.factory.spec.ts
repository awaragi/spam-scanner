import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockImapFlowConstructor } = vi.hoisted(() => {
  return {
    mockImapFlowConstructor: vi.fn(),
  };
});

vi.mock('imapflow', () => ({
  ImapFlow: mockImapFlowConstructor,
}));

import { newClient, safeLogout, withSession } from './imap-connection.factory.js';

describe('newClient', () => {
  beforeEach(() => {
    mockImapFlowConstructor.mockClear();
    mockImapFlowConstructor.mockImplementation(function (config) {
      return { __config: config };
    });
  });

  test('sets secure: true and doSTARTTLS: undefined when imapTls is true', () => {
    newClient({
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapUser: 'user@example.com',
      imapPassword: 'password',
      imapTls: true,
      imapAllowInsecure: false,
    });

    expect(mockImapFlowConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: true,
        doSTARTTLS: undefined,
      })
    );
  });

  test('sets secure: false and doSTARTTLS: true when imapTls is false', () => {
    newClient({
      imapHost: 'imap.example.com',
      imapPort: 143,
      imapUser: 'user@example.com',
      imapPassword: 'password',
      imapTls: false,
      imapAllowInsecure: true,
    });

    expect(mockImapFlowConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: false,
        doSTARTTLS: true,
      })
    );
  });

  test('passes host, port, auth, and other ImapFlow options correctly', () => {
    newClient({
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapUser: 'user@example.com',
      imapPassword: 'secret123',
      imapTls: true,
      imapAllowInsecure: false,
    });

    expect(mockImapFlowConstructor).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'imap.example.com',
        port: 993,
        auth: {
          user: 'user@example.com',
          pass: 'secret123',
        },
        emitLogs: false,
        maxIdleTime: 29 * 60 * 1000,
      })
    );
  });

  test('provides a logger object with all required methods', () => {
    newClient({
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapUser: 'user@example.com',
      imapPassword: 'password',
      imapTls: true,
      imapAllowInsecure: false,
    });

    const config = mockImapFlowConstructor.mock.calls[0][0];
    expect(config.logger).toHaveProperty('debug');
    expect(config.logger).toHaveProperty('info');
    expect(config.logger).toHaveProperty('warn');
    expect(config.logger).toHaveProperty('error');
    expect(config.logger).toHaveProperty('fatal');
    expect(config.logger).toHaveProperty('trace');
  });

  test('redirects logger.info calls to logger.debug when a logger is provided', () => {
    const mockLogger = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      trace: vi.fn(),
    };

    newClient(
      {
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'user@example.com',
        imapPassword: 'password',
        imapTls: true,
        imapAllowInsecure: false,
      },
      mockLogger as any
    );

    const config = mockImapFlowConstructor.mock.calls[0][0];
    const { logger: imapFlowLogger } = config;

    // Call info and verify it delegates to debug (info is bound to debug)
    imapFlowLogger.info('test message');
    expect(mockLogger.debug).toHaveBeenCalledWith('test message');
  });
});

describe('safeLogout', () => {
  test('calls imap.logout()', async () => {
    const mockLogout = vi.fn().mockResolvedValue(undefined);
    const mockImap = { logout: mockLogout } as any;

    await safeLogout(mockImap);

    expect(mockLogout).toHaveBeenCalledOnce();
  });

  test('resolves (not rejects) when logout fails', async () => {
    const mockLogout = vi
      .fn()
      .mockRejectedValue(new Error('connection lost'));
    const mockImap = { logout: mockLogout } as any;

    await expect(safeLogout(mockImap)).resolves.toBeUndefined();
  });

  test('logs the logout failure when a logger is provided', async () => {
    const mockLogger = { debug: vi.fn() };
    const logoutError = new Error('connection lost');
    const mockLogout = vi.fn().mockRejectedValue(logoutError);
    const mockImap = { logout: mockLogout } as any;

    await safeLogout(mockImap, mockLogger as any);

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'connection lost' }),
      'Logout failed (connection likely never established)'
    );
  });

  test('does not throw when logout fails and no logger is provided', async () => {
    const mockLogout = vi
      .fn()
      .mockRejectedValue(new Error('connection lost'));
    const mockImap = { logout: mockLogout } as any;

    await expect(safeLogout(mockImap)).resolves.toBeUndefined();
  });
});

describe('withSession', () => {
  test('connects, calls the callback, then safely logs out', async () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    const mockLogout = vi.fn().mockResolvedValue(undefined);
    const mockCallback = vi.fn().mockResolvedValue('result');

    const mockImap = {
      connect: mockConnect,
      logout: mockLogout,
    };

    mockImapFlowConstructor.mockImplementation(function () {
      return mockImap;
    });

    const result = await withSession(
      {
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'user@example.com',
        imapPassword: 'password',
        imapTls: true,
        imapAllowInsecure: false,
      },
      mockCallback
    );

    expect(mockConnect).toHaveBeenCalledOnce();
    expect(mockCallback).toHaveBeenCalledWith(mockImap);
    expect(mockLogout).toHaveBeenCalledOnce();
    expect(result).toBe('result');
  });

  test('logout is called even when the callback throws', async () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    const mockLogout = vi.fn().mockResolvedValue(undefined);
    const mockCallback = vi.fn().mockRejectedValue(new Error('callback failed'));

    const mockImap = {
      connect: mockConnect,
      logout: mockLogout,
    };

    mockImapFlowConstructor.mockImplementation(function () {
      return mockImap;
    });

    await expect(
      withSession(
        {
          imapHost: 'imap.example.com',
          imapPort: 993,
          imapUser: 'user@example.com',
          imapPassword: 'password',
          imapTls: true,
          imapAllowInsecure: false,
        },
        mockCallback
      )
    ).rejects.toThrow('callback failed');

    expect(mockLogout).toHaveBeenCalledOnce();
  });

  test('logout is called even when connect fails', async () => {
    const mockConnect = vi
      .fn()
      .mockRejectedValue(new Error('connect failed'));
    const mockLogout = vi.fn().mockResolvedValue(undefined);
    const mockCallback = vi.fn();

    const mockImap = {
      connect: mockConnect,
      logout: mockLogout,
    };

    mockImapFlowConstructor.mockImplementation(function () {
      return mockImap;
    });

    await expect(
      withSession(
        {
          imapHost: 'imap.example.com',
          imapPort: 993,
          imapUser: 'user@example.com',
          imapPassword: 'password',
          imapTls: true,
          imapAllowInsecure: false,
        },
        mockCallback
      )
    ).rejects.toThrow('connect failed');

    expect(mockCallback).not.toHaveBeenCalled();
    expect(mockLogout).toHaveBeenCalledOnce();
  });

  test('returns the callback result on success', async () => {
    const mockConnect = vi.fn().mockResolvedValue(undefined);
    const mockLogout = vi.fn().mockResolvedValue(undefined);
    const mockCallback = vi
      .fn()
      .mockResolvedValue({ messageCount: 42 });

    const mockImap = {
      connect: mockConnect,
      logout: mockLogout,
    };

    mockImapFlowConstructor.mockImplementation(function () {
      return mockImap;
    });

    const result = await withSession(
      {
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'user@example.com',
        imapPassword: 'password',
        imapTls: true,
        imapAllowInsecure: false,
      },
      mockCallback
    );

    expect(result).toEqual({ messageCount: 42 });
  });
});
