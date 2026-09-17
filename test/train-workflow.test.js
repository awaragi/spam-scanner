import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockConfig, error } = vi.hoisted(() => ({
  mockConfig: {
    PROCESS_BATCH_SIZE: 10,
    FOLDER_TRAIN_SPAM: 'INBOX.scanner.train.spam',
    FOLDER_TRAIN_HAM: 'INBOX.scanner.train.ham',
    FOLDER_SPAM: 'INBOX.spam',
    FOLDER_INBOX: 'INBOX',
  },
  error: vi.fn(),
}));

vi.mock('../src/lib/utils/config.js', () => ({
  config: mockConfig,
}));

vi.mock('../src/lib/utils/logger.js', () => ({
  rootLogger: {
    forComponent: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error,
    }),
  },
}));

vi.mock('../src/lib/clients/imap-client.js', () => ({
  open: vi.fn(),
  count: vi.fn(),
  fetchAllMessages: vi.fn(),
  moveMessages: vi.fn(),
}));

vi.mock('../src/lib/services/training-service.js', () => ({
  trainSpam: vi.fn(),
  trainHam: vi.fn(),
}));

import { runSpam, runHam } from '../src/lib/workflows/train-workflow.js';
import {
  open,
  count,
  fetchAllMessages,
  moveMessages,
} from '../src/lib/clients/imap-client.js';
import { trainSpam, trainHam } from '../src/lib/services/training-service.js';

const mockImap = {};

function makeMessage(uid) {
  return { uid };
}

describe('train-workflow: per-message failure isolation (4.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    open.mockResolvedValue({});
  });

  test('no messages in folder: trainFn and moveMessages are never called', async () => {
    count.mockReturnValue(0);

    await runSpam(mockImap);

    expect(fetchAllMessages).not.toHaveBeenCalled();
    expect(trainSpam).not.toHaveBeenCalled();
    expect(moveMessages).not.toHaveBeenCalled();
  });

  test('a permanently-failing message in a batch is still moved, alongside the learned ones', async () => {
    const messages = [makeMessage(1), makeMessage(2), makeMessage(3)];
    count.mockReturnValue(3);
    fetchAllMessages.mockResolvedValue(messages);
    // uid 2 was permanently skipped by trainSpam (e.g. a 4xx) - it wasn't
    // learned, but should still be moved on rather than left stuck.
    trainSpam.mockResolvedValue({
      learned: [messages[0], messages[2]],
      skipped: [messages[1]],
    });

    await runSpam(mockImap);

    expect(moveMessages).toHaveBeenCalledWith(
      mockImap,
      [messages[0], messages[2], messages[1]],
      mockConfig.FOLDER_SPAM
    );
  });

  test('transient training failure does not throw: it is logged and swallowed, moveMessages is never called for it', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    count.mockReturnValue(2);
    fetchAllMessages.mockResolvedValue(messages);
    trainHam.mockRejectedValue(
      new Error('rspamd learn (ham) failed transiently for 2 message(s): 1, 2')
    );

    await expect(runHam(mockImap)).resolves.toBeUndefined();

    expect(moveMessages).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });

  test('a failure opening/reading the training folder itself does not throw either', async () => {
    count.mockReturnValue(5);
    fetchAllMessages.mockRejectedValue(new Error('connection dropped'));

    await expect(runSpam(mockImap)).resolves.toBeUndefined();

    expect(moveMessages).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
  });
});
