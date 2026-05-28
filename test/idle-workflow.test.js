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
      on: vi.fn().mockImplementation((event, cb) => { if (event === 'exists') cb({}); }),
      off: vi.fn(),
    };
  });

  test('acquires the mailbox lock and listens for exists event', async () => {
    await runIdle(mockImap);

    expect(mockImap.getMailboxLock).toHaveBeenCalledWith('INBOX', { readOnly: true });
    expect(mockImap.on).toHaveBeenCalledWith('exists', expect.any(Function));
  });

  test('releases the lock after idle resolves successfully', async () => {
    await runIdle(mockImap);

    expect(mockLock.release).toHaveBeenCalledOnce();
  });

  test('releases the lock when getMailboxLock throws an error', async () => {
    mockImap.getMailboxLock.mockRejectedValue(new Error('connection lost'));

    await expect(runIdle(mockImap)).rejects.toThrow('connection lost');

    expect(mockLock.release).not.toHaveBeenCalled();
  });
});
