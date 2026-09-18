import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/lib/utils/config.js', () => ({
  config: {
    FOLDER_INBOX: 'INBOX',
  },
}));

vi.mock('../src/lib/utils/logger.js', () => ({
  rootLogger: {
    forComponent: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { runIdle } from '../src/lib/workflows/idle-workflow.js';

describe('idle-workflow', () => {
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
    await runIdle(mockImap);

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

    await runIdle(mockImap);

    expect(callOrder.indexOf('once:exists')).toBeLessThan(
      callOrder.indexOf('getMailboxLock')
    );
    expect(callOrder.indexOf('once:error')).toBeLessThan(
      callOrder.indexOf('getMailboxLock')
    );
  });

  test('enters IDLE immediately after acquiring the lock', async () => {
    await runIdle(mockImap);

    expect(mockImap.idle).toHaveBeenCalledOnce();
  });

  test('releases the lock and removes listeners after idle resolves', async () => {
    await runIdle(mockImap);

    expect(mockLock.release).toHaveBeenCalledOnce();
    expect(mockImap.off).toHaveBeenCalledWith('exists', expect.any(Function));
    expect(mockImap.off).toHaveBeenCalledWith('error', expect.any(Function));
  });

  test('cleans up listeners and does not release lock when getMailboxLock throws', async () => {
    mockImap.once.mockImplementation(() => {}); // don't auto-resolve
    mockImap.getMailboxLock.mockRejectedValue(new Error('connection lost'));

    await expect(runIdle(mockImap)).rejects.toThrow('connection lost');

    expect(mockImap.off).toHaveBeenCalledWith('exists', expect.any(Function));
    expect(mockImap.off).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockLock.release).not.toHaveBeenCalled();
  });

  test('rejects when the connection emits an error while waiting', async () => {
    mockImap.once.mockImplementation((event, cb) => {
      if (event === 'error') cb(new Error('socket closed'));
    });

    await expect(runIdle(mockImap)).rejects.toThrow('socket closed');

    expect(mockLock.release).toHaveBeenCalledOnce();
  });

  test('rejects when the connection emits close while waiting (4.5: silent disconnect)', async () => {
    mockImap.once.mockImplementation((event, cb) => {
      if (event === 'close') cb();
    });

    await expect(runIdle(mockImap)).rejects.toThrow(
      'IMAP connection closed while waiting for EXISTS'
    );

    expect(mockLock.release).toHaveBeenCalledOnce();
  });

  describe('watchdog (4.5)', () => {
    test('resolves on its own after watchdogMs elapses with no activity', async () => {
      mockImap.once.mockImplementation(() => {}); // never fires naturally

      await runIdle(mockImap, { watchdogMs: 10 });

      expect(mockLock.release).toHaveBeenCalledOnce();
    });

    test('watchdogMs: 0 disables the watchdog (default test config has no activity, so this would hang if not for the test-level cb)', async () => {
      // Sanity check the opposite: with the default beforeEach (exists fires
      // synchronously), disabling the watchdog must not prevent a normal resolve.
      await runIdle(mockImap, { watchdogMs: 0 });

      expect(mockLock.release).toHaveBeenCalledOnce();
    });
  });

  describe('pre-IDLE catch-up (4.5)', () => {
    test('skips IDLE and returns immediately when mail already arrived before the lock was acquired', async () => {
      mockImap.once.mockImplementation(() => {}); // would hang if catch-up didn't short-circuit
      mockImap.mailbox = { exists: 5, uidNext: 10 };

      await runIdle(mockImap, { lastUid: 5, watchdogMs: 0 });

      expect(mockImap.idle).not.toHaveBeenCalled();
      expect(mockLock.release).toHaveBeenCalledOnce();
    });

    test('enters IDLE normally when lastUid is already caught up with the mailbox', async () => {
      mockImap.mailbox = { exists: 5, uidNext: 10 };

      await runIdle(mockImap, { lastUid: 9 });

      expect(mockImap.idle).toHaveBeenCalledOnce();
    });

    test('ignores a non-numeric lastUid and enters IDLE normally', async () => {
      mockImap.mailbox = { exists: 5, uidNext: 10 };

      await runIdle(mockImap, { lastUid: undefined });

      expect(mockImap.idle).toHaveBeenCalledOnce();
    });
  });

  describe('abort signal (5.12: graceful shutdown)', () => {
    test('resolves immediately without entering IDLE when the signal is already aborted', async () => {
      mockImap.once.mockImplementation(() => {}); // would hang if abort wasn't honored
      const controller = new AbortController();
      controller.abort();

      await runIdle(mockImap, { signal: controller.signal, watchdogMs: 0 });

      expect(mockImap.idle).not.toHaveBeenCalled();
      expect(mockLock.release).toHaveBeenCalledOnce();
    });

    test('resolves (not rejects) when the signal aborts while waiting in IDLE', async () => {
      mockImap.once.mockImplementation(() => {}); // never fires naturally
      const controller = new AbortController();

      const promise = runIdle(mockImap, {
        signal: controller.signal,
        watchdogMs: 0,
      });
      controller.abort();

      await expect(promise).resolves.toBeUndefined();
      expect(mockLock.release).toHaveBeenCalledOnce();
    });
  });
});
