import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mock all external dependencies so we can isolate the UID filter logic
const { mockConfig } = vi.hoisted(() => ({
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
    IMAP_USER: 'owner@example.com',
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
      warn: vi.fn(),
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
  appendMessage: vi.fn(),
}));

vi.mock('../src/lib/services/message-service.js', () => ({
  processWithRspamd: vi.fn(),
}));

vi.mock('../src/lib/clients/rspamd-client.js', () => ({
  learnHam: vi.fn(),
}));

vi.mock('../src/lib/utils/spam-classifier.js', () => ({
  categorizeMessages: vi.fn(),
  applyAiEscalation: vi.fn(),
}));

vi.mock('../src/lib/services/ai-classification-service.js', () => ({
  classifyWithAi: vi.fn(),
}));

vi.mock('../src/lib/services/ai-failure-tracker.js', () => ({
  markNotified: vi.fn(),
}));

vi.mock('../src/lib/processors/base-processor.js', () => ({
  createProcessor: vi.fn(),
}));

vi.mock('../src/lib/utils/email.js', () => ({
  dateToString: vi.fn(),
}));

import { runScan } from '../src/lib/workflows/scan-workflow.js';
import {
  readScannerState,
  writeScannerState,
} from '../src/lib/state-manager.js';
import {
  search,
  fetchMessagesByUIDs,
  moveMessages,
  appendMessage,
} from '../src/lib/clients/imap-client.js';
import { processWithRspamd } from '../src/lib/services/message-service.js';
import { learnHam } from '../src/lib/clients/rspamd-client.js';
import {
  categorizeMessages,
  applyAiEscalation,
} from '../src/lib/utils/spam-classifier.js';
import { classifyWithAi } from '../src/lib/services/ai-classification-service.js';
import { markNotified } from '../src/lib/services/ai-failure-tracker.js';
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
    readScannerState.mockResolvedValue({
      last_uid: lastUID,
      last_seen_date: new Date().toISOString(),
      last_checked: new Date().toISOString(),
    });
    // IMAP wraps 7385:* → returns [7384]
    search.mockResolvedValue([lastUID]);

    const result = await runScan(mockImap);

    expect(fetchMessagesByUIDs).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0 });
    expect(readScannerState).toHaveBeenCalledWith(
      mockImap,
      expect.any(Object),
      mockConfig.FOLDER_INBOX
    );
  });

  test('Normal case: search returns UIDs greater than lastUID, all are enqueued', async () => {
    const lastUID = 7384;
    const newUIDs = [7385, 7386, 7387];
    readScannerState.mockResolvedValue({
      last_uid: lastUID,
      last_seen_date: new Date().toISOString(),
      last_checked: new Date().toISOString(),
    });
    search.mockResolvedValue(newUIDs);
    fetchMessagesByUIDs.mockResolvedValue(
      newUIDs.map(uid => ({
        uid,
        envelope: { date: new Date() },
        body: '',
      }))
    );

    const result = await runScan(mockImap);

    expect(fetchMessagesByUIDs).toHaveBeenCalledWith(mockImap, newUIDs);
    expect(result).toEqual({ processed: newUIDs.length });
  });

  test('Mixed case: search returns stale and new UIDs, only new ones are enqueued', async () => {
    const lastUID = 7384;
    const newUIDs = [7385, 7386];
    readScannerState.mockResolvedValue({
      last_uid: lastUID,
      last_seen_date: new Date().toISOString(),
      last_checked: new Date().toISOString(),
    });
    // Server returns lastUID alongside new UIDs
    search.mockResolvedValue([lastUID, ...newUIDs]);
    fetchMessagesByUIDs.mockResolvedValue(
      newUIDs.map(uid => ({
        uid,
        envelope: { date: new Date() },
        body: '',
      }))
    );

    await runScan(mockImap);

    expect(fetchMessagesByUIDs).toHaveBeenCalledWith(mockImap, newUIDs);
  });
});

describe('scan-workflow state advancement past permanently-skipped messages (4.4)', () => {
  let mockProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.AI_ENABLED = false;
    categorizeMessages.mockReturnValue({
      whitelistedMessages: [],
      lowSpamMessages: [],
      highSpamMessages: [],
      nonSpamMessages: [],
      spamMessages: [],
    });
    mockProcessor = { process: vi.fn() };
    createProcessor.mockResolvedValue(mockProcessor);
  });

  test('last_uid still advances past a message that processWithRspamd permanently skipped', async () => {
    const lastUID = 100;
    const fetchedUids = [101, 102];
    readScannerState.mockResolvedValue({
      last_uid: lastUID,
      last_seen_date: new Date().toISOString(),
      last_checked: new Date().toISOString(),
    });
    search.mockResolvedValue(fetchedUids);
    fetchMessagesByUIDs.mockResolvedValue(
      fetchedUids.map(uid => ({
        uid,
        envelope: { date: new Date() },
        body: '',
      }))
    );
    // processWithRspamd only returns uid 101 - uid 102 was permanently skipped
    // internally (e.g. a 4xx from rspamd), but its UID must still be present
    // in the fetched `messages` array used for the last_uid calculation.
    processWithRspamd.mockResolvedValue([{ uid: 101 }]);
    categorizeMessages.mockReturnValue({
      whitelistedMessages: [],
      lowSpamMessages: [],
      highSpamMessages: [],
      nonSpamMessages: [{ uid: 101 }],
      spamMessages: [],
    });

    await runScan(mockImap);

    expect(writeScannerState).toHaveBeenCalledWith(
      mockImap,
      expect.objectContaining({ last_uid: 102 })
    );
  });
});

describe('scan-workflow AI escalation wiring', () => {
  let mockProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.AI_ENABLED = false;

    readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: new Date().toISOString(),
      last_checked: new Date().toISOString(),
    });
    search.mockResolvedValue([101]);
    fetchMessagesByUIDs.mockResolvedValue([
      { uid: 101, envelope: { date: new Date() }, body: '' },
    ]);
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
    expect(moveMessages).toHaveBeenCalledWith(
      mockImap,
      categorized.spamMessages,
      'INBOX.spam'
    );
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
    expect(moveMessages).toHaveBeenCalledWith(
      mockImap,
      escalated.spamMessages,
      'INBOX.spam'
    );
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
    expect(moveMessages).toHaveBeenCalledWith(
      mockImap,
      escalated.spamMessages,
      'INBOX.spam'
    );
  });
});

describe('scan-workflow AI failure alert wiring', () => {
  let mockProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.AI_ENABLED = true;

    readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: new Date().toISOString(),
      last_checked: new Date().toISOString(),
    });
    search.mockResolvedValue([101]);
    fetchMessagesByUIDs.mockResolvedValue([
      { uid: 101, envelope: { date: new Date() }, body: '' },
    ]);
    processWithRspamd.mockResolvedValue([{ uid: 101 }]);
    mockProcessor = { process: vi.fn() };
    createProcessor.mockResolvedValue(mockProcessor);

    categorizeMessages.mockReturnValue({
      whitelistedMessages: [],
      nonSpamMessages: [{ uid: 101 }],
      lowSpamMessages: [],
      highSpamMessages: [],
      spamMessages: [],
    });
    applyAiEscalation.mockReturnValue({
      nonSpamMessages: [{ uid: 101 }],
      lowSpamMessages: [],
      highSpamMessages: [],
      spamMessages: [],
    });
  });

  test('aiFailureAlert present: appends an alert message to FOLDER_INBOX and marks the tracker notified', async () => {
    const alert = {
      reason: 'RateLimitError',
      count: 3,
      lastError: 'Too many requests',
      lastAt: '2026-09-17T00:00:00.000Z',
    };
    classifyWithAi.mockResolvedValue({
      nonSpamMessages: [],
      lowSpamMessages: [],
      aiFailureAlert: alert,
    });

    await runScan(mockImap);

    expect(appendMessage).toHaveBeenCalledTimes(1);
    const [imapArg, folderArg, rawArg] = appendMessage.mock.calls[0];
    expect(imapArg).toBe(mockImap);
    expect(folderArg).toBe('INBOX');
    expect(rawArg).toContain('RateLimitError');
    expect(rawArg).toContain('Too many requests');
    expect(rawArg).toContain('Consecutive failures: 3');
    expect(rawArg).toMatch(/^Message-ID: <.+@spam-scanner\.internal>$/m);
    expect(markNotified).toHaveBeenCalledWith('RateLimitError');
    // Trains rspamd's Bayes classifier on the exact posted content, so it scores as ham.
    expect(learnHam).toHaveBeenCalledWith(rawArg);
  });

  test('learnHam failure does not affect the already-posted alert or the tracker', async () => {
    const alert = {
      reason: 'RateLimitError',
      count: 3,
      lastError: 'Too many requests',
      lastAt: '2026-09-17T00:00:00.000Z',
    };
    classifyWithAi.mockResolvedValue({
      nonSpamMessages: [],
      lowSpamMessages: [],
      aiFailureAlert: alert,
    });
    learnHam.mockRejectedValue(new Error('rspamd learnham failed'));

    const result = await runScan(mockImap);

    expect(result).toEqual({ processed: 1 });
    expect(markNotified).toHaveBeenCalledWith('RateLimitError');
    expect(mockProcessor.process).toHaveBeenCalled();
  });

  test('aiFailureAlert null: no alert is appended and the tracker is not marked notified', async () => {
    classifyWithAi.mockResolvedValue({
      nonSpamMessages: [],
      lowSpamMessages: [],
      aiFailureAlert: null,
    });

    await runScan(mockImap);

    expect(appendMessage).not.toHaveBeenCalled();
    expect(markNotified).not.toHaveBeenCalled();
  });

  test('appendMessage failure does not abort the batch and does not mark the tracker notified', async () => {
    const alert = {
      reason: 'RateLimitError',
      count: 3,
      lastError: 'Too many requests',
      lastAt: '2026-09-17T00:00:00.000Z',
    };
    classifyWithAi.mockResolvedValue({
      nonSpamMessages: [],
      lowSpamMessages: [],
      aiFailureAlert: alert,
    });
    appendMessage.mockRejectedValue(new Error('IMAP append failed'));

    const result = await runScan(mockImap);

    expect(result).toEqual({ processed: 1 });
    expect(markNotified).not.toHaveBeenCalled();
    expect(mockProcessor.process).toHaveBeenCalled();
  });
});
