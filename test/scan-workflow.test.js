import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies so we can isolate the UID filter logic
vi.mock('../src/lib/utils/config.js', () => ({
  config: {
    FOLDER_INBOX: 'INBOX',
    FOLDER_SPAM: 'INBOX.spam',
    SCAN_READ: true,
    SCAN_BATCH_SIZE: 10000,
    PROCESS_BATCH_SIZE: 10,
    SPAM_PROCESSING_MODE: 'folder',
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

vi.mock('../src/lib/state-manager.js', () => ({
  readScannerState: vi.fn(),
  writeScannerState: vi.fn(),
}));

vi.mock('../src/lib/clients/imap-client.js', () => ({
  open: vi.fn(),
  search: vi.fn(),
  fetchMessagesByUIDs: vi.fn(),
  moveMessages: vi.fn(),
}));

vi.mock('../src/lib/services/message-service.js', () => ({
  processWithRspamd: vi.fn(),
}));

vi.mock('../src/lib/utils/spam-classifier.js', () => ({
  categorizeMessages: vi.fn(),
}));

vi.mock('../src/lib/processors/base-processor.js', () => ({
  createProcessor: vi.fn(),
}));

vi.mock('../src/lib/utils/email.js', () => ({
  dateToString: vi.fn(),
}));

import { run } from '../src/lib/workflows/scan-workflow.js';
import { readScannerState } from '../src/lib/state-manager.js';
import { search, fetchMessagesByUIDs } from '../src/lib/clients/imap-client.js';
import { processWithRspamd } from '../src/lib/services/message-service.js';
import { categorizeMessages } from '../src/lib/utils/spam-classifier.js';
import { createProcessor } from '../src/lib/processors/base-processor.js';

const mockImap = {};

describe('scan-workflow UID filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no messages to process
    categorizeMessages.mockReturnValue({
      lowSpamMessages: [],
      highSpamMessages: [],
      nonSpamMessages: [],
      spamMessages: [],
    });
    processWithRspamd.mockResolvedValue([]);
    createProcessor.mockResolvedValue({ process: vi.fn() });
  });

  test('IMAP range inversion: search returns only lastUID, no messages are processed', async () => {
    const lastUID = 7384;
    readScannerState.mockResolvedValue({ last_uid: lastUID, last_seen_date: new Date().toISOString(), last_checked: new Date().toISOString() });
    // IMAP wraps 7385:* → returns [7384]
    search.mockResolvedValue([lastUID]);

    await run(mockImap);

    expect(fetchMessagesByUIDs).not.toHaveBeenCalled();
  });

  test('Normal case: search returns UIDs greater than lastUID, all are enqueued', async () => {
    const lastUID = 7384;
    const newUIDs = [7385, 7386, 7387];
    readScannerState.mockResolvedValue({ last_uid: lastUID, last_seen_date: new Date().toISOString(), last_checked: new Date().toISOString() });
    search.mockResolvedValue(newUIDs);
    fetchMessagesByUIDs.mockResolvedValue(newUIDs.map(uid => ({
      uid,
      envelope: { date: new Date() },
      body: '',
    })));

    await run(mockImap);

    expect(fetchMessagesByUIDs).toHaveBeenCalledWith(mockImap, newUIDs);
  });

  test('Mixed case: search returns stale and new UIDs, only new ones are enqueued', async () => {
    const lastUID = 7384;
    const newUIDs = [7385, 7386];
    readScannerState.mockResolvedValue({ last_uid: lastUID, last_seen_date: new Date().toISOString(), last_checked: new Date().toISOString() });
    // Server returns lastUID alongside new UIDs
    search.mockResolvedValue([lastUID, ...newUIDs]);
    fetchMessagesByUIDs.mockResolvedValue(newUIDs.map(uid => ({
      uid,
      envelope: { date: new Date() },
      body: '',
    })));

    await run(mockImap);

    expect(fetchMessagesByUIDs).toHaveBeenCalledWith(mockImap, newUIDs);
  });
});
