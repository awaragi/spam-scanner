import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies so we can isolate the UID filter logic
const {mockConfig} = vi.hoisted(() => ({
  mockConfig: {
    FOLDER_INBOX: 'INBOX',
    FOLDER_SPAM: 'INBOX.spam',
    SCAN_READ: true,
    SCAN_BATCH_SIZE: 10000,
    PROCESS_BATCH_SIZE: 10,
    SPAM_PROCESSING_MODE: 'folder',
    AI_ENABLED: false,
    AI_ESCALATE_TO_LOW_THRESHOLD: 50,
    AI_ESCALATE_TO_HIGH_THRESHOLD: 80,
  },
}));

vi.mock('../src/lib/utils/config.js', () => ({
  config: mockConfig,
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
  applyAiEscalation: vi.fn(),
}));

vi.mock('../src/lib/services/ai-classification-service.js', () => ({
  classifyWithAi: vi.fn(),
}));

vi.mock('../src/lib/processors/base-processor.js', () => ({
  createProcessor: vi.fn(),
}));

vi.mock('../src/lib/utils/email.js', () => ({
  dateToString: vi.fn(),
}));

import { runScan } from '../src/lib/workflows/scan-workflow.js';
import { readScannerState } from '../src/lib/state-manager.js';
import { search, fetchMessagesByUIDs, moveMessages } from '../src/lib/clients/imap-client.js';
import { processWithRspamd } from '../src/lib/services/message-service.js';
import { categorizeMessages, applyAiEscalation } from '../src/lib/utils/spam-classifier.js';
import { classifyWithAi } from '../src/lib/services/ai-classification-service.js';
import { createProcessor } from '../src/lib/processors/base-processor.js';

const mockImap = {};

describe('scan-workflow UID filter', () => {
  let mockProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.AI_ENABLED = false;

    // Default: no messages to process
    categorizeMessages.mockReturnValue({
      whitelistedMessages: [],
      lowSpamMessages: [],
      highSpamMessages: [],
      nonSpamMessages: [],
      spamMessages: [],
    });
    processWithRspamd.mockResolvedValue([]);
    mockProcessor = { process: vi.fn() };
    createProcessor.mockResolvedValue(mockProcessor);
  });

  test('IMAP range inversion: search returns only lastUID, no messages are processed', async () => {
    const lastUID = 7384;
    readScannerState.mockResolvedValue({ last_uid: lastUID, last_seen_date: new Date().toISOString(), last_checked: new Date().toISOString() });
    // IMAP wraps 7385:* → returns [7384]
    search.mockResolvedValue([lastUID]);

    const result = await runScan(mockImap);

    expect(fetchMessagesByUIDs).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0 });
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

    const result = await runScan(mockImap);

    expect(fetchMessagesByUIDs).toHaveBeenCalledWith(mockImap, newUIDs);
    expect(result).toEqual({ processed: newUIDs.length });
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

    await runScan(mockImap);

    expect(fetchMessagesByUIDs).toHaveBeenCalledWith(mockImap, newUIDs);
  });
});

describe('scan-workflow AI escalation wiring', () => {
  let mockProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.AI_ENABLED = false;

    readScannerState.mockResolvedValue({ last_uid: 100, last_seen_date: new Date().toISOString(), last_checked: new Date().toISOString() });
    search.mockResolvedValue([101]);
    fetchMessagesByUIDs.mockResolvedValue([{ uid: 101, envelope: { date: new Date() }, body: '' }]);
    processWithRspamd.mockResolvedValue([{ uid: 101 }]);
    mockProcessor = { process: vi.fn() };
    createProcessor.mockResolvedValue(mockProcessor);
  });

  test('AI_ENABLED=false: classifyWithAi/applyAiEscalation are never called, processor/moveMessages receive raw categorizeMessages output', async () => {
    const categorized = {
      whitelistedMessages: [],
      nonSpamMessages: [{ uid: 101 }],
      lowSpamMessages: [],
      highSpamMessages: [],
      spamMessages: [],
    };
    categorizeMessages.mockReturnValue(categorized);

    await runScan(mockImap);

    expect(classifyWithAi).not.toHaveBeenCalled();
    expect(applyAiEscalation).not.toHaveBeenCalled();
    expect(mockProcessor.process).toHaveBeenCalledWith(mockImap, {
      nonSpamMessages: categorized.nonSpamMessages,
      lowSpamMessages: categorized.lowSpamMessages,
      highSpamMessages: categorized.highSpamMessages,
    });
    expect(moveMessages).toHaveBeenCalledWith(mockImap, categorized.spamMessages, 'INBOX.spam');
  });

  test('AI_ENABLED=true: classifyWithAi and applyAiEscalation are called with the expected args, and their output reaches processor/moveMessages', async () => {
    mockConfig.AI_ENABLED = true;

    const categorized = {
      whitelistedMessages: [],
      nonSpamMessages: [{ uid: 101 }],
      lowSpamMessages: [{ uid: 102 }],
      highSpamMessages: [{ uid: 103 }],
      spamMessages: [{ uid: 104 }],
    };
    categorizeMessages.mockReturnValue(categorized);

    const aiResults = {
      nonSpamMessages: [{ uid: 101, aiInfo: { score: 10 } }],
      lowSpamMessages: [{ uid: 102, aiInfo: { score: 90 } }],
    };
    classifyWithAi.mockResolvedValue(aiResults);

    const escalated = {
      nonSpamMessages: [{ uid: 101 }],
      lowSpamMessages: [],
      highSpamMessages: [{ uid: 102 }, { uid: 103 }],
      spamMessages: [{ uid: 104 }],
    };
    applyAiEscalation.mockReturnValue(escalated);

    await runScan(mockImap);

    expect(classifyWithAi).toHaveBeenCalledWith({
      nonSpamMessages: categorized.nonSpamMessages,
      lowSpamMessages: categorized.lowSpamMessages,
    });
    expect(applyAiEscalation).toHaveBeenCalledWith(categorized, aiResults, {
      escalateToLowThreshold: mockConfig.AI_ESCALATE_TO_LOW_THRESHOLD,
      escalateToHighThreshold: mockConfig.AI_ESCALATE_TO_HIGH_THRESHOLD,
    });
    expect(mockProcessor.process).toHaveBeenCalledWith(mockImap, {
      nonSpamMessages: escalated.nonSpamMessages,
      lowSpamMessages: escalated.lowSpamMessages,
      highSpamMessages: escalated.highSpamMessages,
    });
    expect(moveMessages).toHaveBeenCalledWith(mockImap, escalated.spamMessages, 'INBOX.spam');
  });

  test('AI_ENABLED=true: whitelisted messages are excluded from classifyWithAi and merged back into nonSpamMessages for processor/moveMessages', async () => {
    mockConfig.AI_ENABLED = true;

    const whitelisted = { uid: 999 };
    const categorized = {
      whitelistedMessages: [whitelisted],
      nonSpamMessages: [{ uid: 101 }],
      lowSpamMessages: [{ uid: 102 }],
      highSpamMessages: [],
      spamMessages: [],
    };
    categorizeMessages.mockReturnValue(categorized);

    const aiResults = {
      nonSpamMessages: [{ uid: 101, aiInfo: { score: 10 } }],
      lowSpamMessages: [{ uid: 102, aiInfo: { score: 20 } }],
    };
    classifyWithAi.mockResolvedValue(aiResults);

    const escalated = {
      nonSpamMessages: [{ uid: 101 }],
      lowSpamMessages: [{ uid: 102 }],
      highSpamMessages: [],
      spamMessages: [],
    };
    applyAiEscalation.mockReturnValue(escalated);

    await runScan(mockImap);

    // The whitelisted message must never be sent to classifyWithAi.
    expect(classifyWithAi).toHaveBeenCalledWith({
      nonSpamMessages: categorized.nonSpamMessages,
      lowSpamMessages: categorized.lowSpamMessages,
    });

    // It must reappear as clean mail in the final processor call.
    expect(mockProcessor.process).toHaveBeenCalledWith(mockImap, {
      nonSpamMessages: [...escalated.nonSpamMessages, whitelisted],
      lowSpamMessages: escalated.lowSpamMessages,
      highSpamMessages: escalated.highSpamMessages,
    });
    expect(moveMessages).toHaveBeenCalledWith(mockImap, escalated.spamMessages, 'INBOX.spam');
  });
});
