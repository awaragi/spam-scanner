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
      once: vi.fn().mockImplementation((event, cb) => { if (event === 'exists') cb({}); }),
      off: vi.fn(),
      idle: vi.fn().mockResolvedValue(undefined),
    };
  });

  test('acquires the mailbox lock in read-only mode', async () => {
    await runIdle(mockImap);

    expect(mockImap.getMailboxLock).toHaveBeenCalledWith('INBOX', { readOnly: true });
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

    expect(callOrder.indexOf('once:exists')).toBeLessThan(callOrder.indexOf('getMailboxLock'));
    expect(callOrder.indexOf('once:error')).toBeLessThan(callOrder.indexOf('getMailboxLock'));
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
});
