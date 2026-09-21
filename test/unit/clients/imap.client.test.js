import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/lib/core/config.js', () => ({ config: {} }));
vi.mock('../../../src/lib/core/logger.js', () => ({
  rootLogger: {
    forComponent: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import {
  safeLogout,
  waitForNewMail,
} from '../../../src/lib/clients/imap.client.js';

describe('safeLogout', () => {
  test('calls imap.logout()', async () => {
    const imap = { logout: vi.fn().mockResolvedValue() };
    await safeLogout(imap);
    expect(imap.logout).toHaveBeenCalled();
  });

  test('swallows a logout failure rather than throwing (e.g. connect() never succeeded)', async () => {
    const imap = {
      logout: vi.fn().mockRejectedValue(new Error('no connection')),
    };
    await expect(safeLogout(imap)).resolves.toBeUndefined();
  });
});

describe('waitForNewMail', () => {
  let mockLock;
  let mockImap;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLock = { release: vi.fn() };
    mockImap = {
      getMailboxLock: vi.fn().mockResolvedValue(mockLock),
      mailbox: { exists: 0 },
      once: vi.fn().mockImplementation((event, cb) => {
        if (event === 'exists') cb({});
      }),
      off: vi.fn(),
      idle: vi.fn().mockResolvedValue(undefined),
    };
  });

  test('acquires the mailbox lock in read-only mode', async () => {
    await waitForNewMail(mockImap, 'INBOX');

    expect(mockImap.getMailboxLock).toHaveBeenCalledWith('INBOX', {
      readOnly: true,
    });
  });

  test('registers exists and error listeners before acquiring the lock', async () => {
    const callOrder = [];
    mockImap.once.mockImplementation((event, cb) => {
      callOrder.push(`once:${event}`);
      if (event === 'exists') cb({});
    });
    mockImap.getMailboxLock.mockImplementation(() => {
      callOrder.push('getMailboxLock');
      return Promise.resolve(mockLock);
    });

    await waitForNewMail(mockImap, 'INBOX');

    expect(callOrder.indexOf('once:exists')).toBeLessThan(
      callOrder.indexOf('getMailboxLock')
    );
    expect(callOrder.indexOf('once:error')).toBeLessThan(
      callOrder.indexOf('getMailboxLock')
    );
  });

  test('enters IDLE immediately after acquiring the lock', async () => {
    await waitForNewMail(mockImap, 'INBOX');

    expect(mockImap.idle).toHaveBeenCalledOnce();
  });

  test('releases the lock and removes listeners after idle resolves', async () => {
    await waitForNewMail(mockImap, 'INBOX');

    expect(mockLock.release).toHaveBeenCalledOnce();
    expect(mockImap.off).toHaveBeenCalledWith('exists', expect.any(Function));
    expect(mockImap.off).toHaveBeenCalledWith('error', expect.any(Function));
  });

  test('cleans up listeners and does not release lock when getMailboxLock throws', async () => {
    mockImap.once.mockImplementation(() => {}); // don't auto-resolve
    mockImap.getMailboxLock.mockRejectedValue(new Error('connection lost'));

    await expect(waitForNewMail(mockImap, 'INBOX')).rejects.toThrow(
      'connection lost'
    );

    expect(mockImap.off).toHaveBeenCalledWith('exists', expect.any(Function));
    expect(mockImap.off).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockLock.release).not.toHaveBeenCalled();
  });

  test('rejects when the connection emits an error while waiting', async () => {
    mockImap.once.mockImplementation((event, cb) => {
      if (event === 'error') cb(new Error('socket closed'));
    });

    await expect(waitForNewMail(mockImap, 'INBOX')).rejects.toThrow(
      'socket closed'
    );

    expect(mockLock.release).toHaveBeenCalledOnce();
  });

  test('rejects when the connection emits close while waiting (silent disconnect)', async () => {
    mockImap.once.mockImplementation((event, cb) => {
      if (event === 'close') cb();
    });

    await expect(waitForNewMail(mockImap, 'INBOX')).rejects.toThrow(
      'IMAP connection closed while waiting for EXISTS'
    );

    expect(mockLock.release).toHaveBeenCalledOnce();
  });

  describe('watchdog', () => {
    test('resolves on its own after watchdogMs elapses with no activity', async () => {
      mockImap.once.mockImplementation(() => {}); // never fires naturally

      await waitForNewMail(mockImap, 'INBOX', { watchdogMs: 10 });

      expect(mockLock.release).toHaveBeenCalledOnce();
    });

    test('watchdogMs: 0 disables the watchdog (default test config has no activity, so this would hang if not for the test-level cb)', async () => {
      await waitForNewMail(mockImap, 'INBOX', { watchdogMs: 0 });

      expect(mockLock.release).toHaveBeenCalledOnce();
    });
  });

  describe('pre-IDLE catch-up', () => {
    test('skips IDLE and returns immediately when mail already arrived before the lock was acquired', async () => {
      mockImap.once.mockImplementation(() => {}); // would hang if catch-up didn't short-circuit
      mockImap.mailbox = { exists: 5, uidNext: 10 };

      await waitForNewMail(mockImap, 'INBOX', { lastUid: 5, watchdogMs: 0 });

      expect(mockImap.idle).not.toHaveBeenCalled();
      expect(mockLock.release).toHaveBeenCalledOnce();
    });

    test('enters IDLE normally when lastUid is already caught up with the mailbox', async () => {
      mockImap.mailbox = { exists: 5, uidNext: 10 };

      await waitForNewMail(mockImap, 'INBOX', { lastUid: 9 });

      expect(mockImap.idle).toHaveBeenCalledOnce();
    });

    test('ignores a non-numeric lastUid and enters IDLE normally', async () => {
      mockImap.mailbox = { exists: 5, uidNext: 10 };

      await waitForNewMail(mockImap, 'INBOX', { lastUid: undefined });

      expect(mockImap.idle).toHaveBeenCalledOnce();
    });
  });

  describe('abort signal', () => {
    test('resolves immediately without entering IDLE when the signal is already aborted', async () => {
      mockImap.once.mockImplementation(() => {}); // would hang if abort wasn't honored
      const controller = new AbortController();
      controller.abort();

      await waitForNewMail(mockImap, 'INBOX', {
        signal: controller.signal,
        watchdogMs: 0,
      });

      expect(mockImap.idle).not.toHaveBeenCalled();
      expect(mockLock.release).toHaveBeenCalledOnce();
    });

    test('resolves (not rejects) when the signal aborts while waiting in IDLE', async () => {
      mockImap.once.mockImplementation(() => {}); // never fires naturally
      const controller = new AbortController();

      const promise = waitForNewMail(mockImap, 'INBOX', {
        signal: controller.signal,
        watchdogMs: 0,
      });
      controller.abort();

      await expect(promise).resolves.toBeUndefined();
      expect(mockLock.release).toHaveBeenCalledOnce();
    });
  });
});
