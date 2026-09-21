import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  fixtureMessage,
  fixtureContext,
  fixtureRspamdCheck,
  fixtureAiResult,
} from '../../../support/fixtures.js';

// vi.mock() factories are hoisted above imports/consts, so anything they
// reference has to come from vi.hoisted() - and vi.hoisted()'s own callback
// runs before static imports resolve too, so a statically-imported factory
// referenced inside it throws (verified). Importing dynamically INSIDE the
// hoisted callback sidesteps this - it's not evaluated until the callback
// itself runs, by which point the module graph is ready.
const { fakeImapClient, fakeRspamdClient, fakeAiClient, fakeStateManager } =
  await vi.hoisted(async () => {
    const {
      createFakeImapClient,
      createFakeRspamdClient,
      createFakeAiClient,
      createFakeStateManagerClient,
    } = await import('../../../support/fake-clients.js');
    return {
      fakeImapClient: createFakeImapClient(),
      fakeRspamdClient: createFakeRspamdClient(),
      fakeAiClient: createFakeAiClient(),
      fakeStateManager: createFakeStateManagerClient(),
    };
  });

// Only the clients layer is mocked (scan.controller.js touches 4 of the 5 -
// never folder-resolver.client.js, that's init.controller.js only). Real:
// spam-classifier/sender-lists/scan-progress/alert-email services,
// rspamd-check/ai-classification/label-apply/folder-move steps - and
// config.js itself, via the plain ctx object below.
vi.mock('../../../../src/lib/clients/imap.client.js', () => fakeImapClient);
vi.mock('../../../../src/lib/clients/rspamd.client.js', () => fakeRspamdClient);
vi.mock('../../../../src/lib/clients/ai.client.js', () => fakeAiClient);
vi.mock(
  '../../../../src/lib/clients/state-manager.client.js',
  () => fakeStateManager
);

const { runScan } = await import(
  '../../../../src/lib/controllers/workflows/scan.controller.js'
);

// The fake client objects are module-level singletons shared across every
// test() in this file (vi.hoisted() only runs once per file) - without
// this, a mock's call count or a mockResolvedValue/mockImplementation
// override from an earlier test leaks into the next one. vi.clearAllMocks()
// only resets call history (mock.calls/results/instances), not a custom
// mockImplementation/mockResolvedValue set by a previous test - so every
// mock a test might override gets its sane default re-applied here too,
// and any test that needs something different overrides it again locally.
beforeEach(() => {
  vi.clearAllMocks();
  fakeStateManager.readScannerState.mockResolvedValue({
    last_uid: 100,
    last_seen_date: '',
    last_checked: '',
  });
  fakeStateManager.readMapState.mockResolvedValue([]);
  fakeStateManager.writeScannerState.mockResolvedValue(true);
  fakeImapClient.open.mockResolvedValue({ uidValidity: 1n, uidNext: 200 });
  fakeImapClient.appendMessage.mockResolvedValue();
  fakeImapClient.moveMessages.mockResolvedValue();
  fakeRspamdClient.checkEmail.mockResolvedValue(fixtureRspamdCheck());
  fakeRspamdClient.learnHam.mockResolvedValue();
  fakeAiClient.classifyEmail.mockResolvedValue(fixtureAiResult());
});

test('a blacklisted sender is moved to spam without ever reaching rspamd or AI', async () => {
  const fakeImap = {}; // opaque token - only reference-equality matters in assertions below
  const ctx = fixtureContext(); // plain object literal - no vi.mock() involved at all

  fakeStateManager.readScannerState.mockResolvedValue({
    last_uid: 100,
    last_seen_date: '',
    last_checked: '',
  });
  fakeStateManager.readMapState.mockImplementation((imap, key) =>
    key === ctx.config.STATE_KEY_BLACKLIST_MAP ? ['bad@evil.com'] : []
  );
  fakeImapClient.search.mockResolvedValue([101, 102]);
  fakeImapClient.fetchMessagesByUIDs.mockResolvedValue([
    fixtureMessage({ uid: 101, from: 'bad@evil.com' }),
    fixtureMessage({ uid: 102, from: 'ok@example.com' }),
  ]);
  fakeRspamdClient.checkEmail.mockResolvedValue({
    score: 5,
    required_score: 15,
  });

  await runScan(fakeImap, ctx);

  expect(fakeRspamdClient.checkEmail).toHaveBeenCalledTimes(1); // only uid 102
  expect(fakeImapClient.moveMessages).toHaveBeenCalledWith(
    fakeImap,
    expect.arrayContaining([expect.objectContaining({ uid: 101 })]),
    ctx.config.FOLDER_SPAM
  );
});

describe('UID filter', () => {
  test('IMAP range inversion: search returns only lastUID, no messages are processed', async () => {
    const ctx = fixtureContext();
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: 7384,
      last_seen_date: '',
      last_checked: '',
    });
    fakeImapClient.search.mockResolvedValue([7384]); // server wraps 7385:* -> [7384]

    const result = await runScan({}, ctx);

    expect(fakeImapClient.fetchMessagesByUIDs).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, last_uid: 7384 });
  });

  test('normal case: search returns UIDs greater than lastUID, all are enqueued', async () => {
    const ctx = fixtureContext();
    const lastUID = 100;
    const newUIDs = [101, 102, 103];
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: lastUID,
      last_seen_date: '',
      last_checked: '',
    });
    fakeImapClient.search.mockResolvedValue(newUIDs);
    fakeImapClient.fetchMessagesByUIDs.mockResolvedValue(
      newUIDs.map(uid => fixtureMessage({ uid }))
    );

    const result = await runScan({}, ctx);

    expect(fakeImapClient.fetchMessagesByUIDs).toHaveBeenCalledWith(
      {},
      newUIDs
    );
    expect(result).toEqual({
      processed: newUIDs.length,
      last_uid: Math.max(...newUIDs),
    });
  });

  test('mixed case: search returns stale and new UIDs, only new ones are enqueued', async () => {
    const ctx = fixtureContext();
    const lastUID = 100;
    const newUIDs = [101, 102];
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: lastUID,
      last_seen_date: '',
      last_checked: '',
    });
    fakeImapClient.search.mockResolvedValue([lastUID, ...newUIDs]);
    fakeImapClient.fetchMessagesByUIDs.mockResolvedValue(
      newUIDs.map(uid => fixtureMessage({ uid }))
    );

    await runScan({}, ctx);

    expect(fakeImapClient.fetchMessagesByUIDs).toHaveBeenCalledWith(
      {},
      newUIDs
    );
  });
});

describe('last_uid advancement past permanently-skipped messages', () => {
  test('last_uid still advances past a message rspamd permanently rejected (4xx)', async () => {
    const ctx = fixtureContext();
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    fakeImapClient.search.mockResolvedValue([101, 102]);
    fakeImapClient.fetchMessagesByUIDs.mockResolvedValue([
      fixtureMessage({ uid: 101 }),
      fixtureMessage({ uid: 102 }),
    ]);
    // uid 101's rspamd check is permanently rejected (4xx) - it never gets
    // spamInfo, but its UID must still count toward last_uid.
    let call = 0;
    fakeRspamdClient.checkEmail.mockImplementation(async () => {
      call++;
      if (call === 1) {
        const err = new Error('bad request');
        err.status = 400;
        throw err;
      }
      return { score: 1, required_score: 15 };
    });

    await runScan({}, ctx);

    expect(fakeStateManager.writeScannerState).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ last_uid: 102 })
    );
  });
});

describe('AI escalation wiring', () => {
  test('AI_ENABLED=false: AI is never called', async () => {
    const ctx = fixtureContext({ config: { AI_ENABLED: false } });
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    fakeImapClient.search.mockResolvedValue([101]);
    fakeImapClient.fetchMessagesByUIDs.mockResolvedValue([
      fixtureMessage({ uid: 101 }),
    ]);
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    }); // clean tier

    await runScan({}, ctx);

    expect(fakeAiClient.classifyEmail).not.toHaveBeenCalled();
  });

  test('AI_ENABLED=true: a clean-tier message the AI scores high escalates to a spam-likelihood folder/label', async () => {
    const ctx = fixtureContext({
      config: {
        AI_ENABLED: true,
        SPAM_PROCESSING_MODE: 'folder',
        AI_ESCALATE_TO_LOW_THRESHOLD: 50,
        AI_ESCALATE_TO_HIGH_THRESHOLD: 80,
      },
    });
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    fakeImapClient.search.mockResolvedValue([101]);
    fakeImapClient.fetchMessagesByUIDs.mockResolvedValue([
      fixtureMessage({ uid: 101 }),
    ]);
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    }); // clean tier from rspamd
    fakeAiClient.classifyEmail.mockResolvedValue({
      score: 90,
      reasoning: 'looks like phishing',
    });

    await runScan({}, ctx);

    expect(fakeImapClient.moveMessages).toHaveBeenCalledWith(
      {},
      expect.arrayContaining([expect.objectContaining({ uid: 101 })]),
      ctx.config.FOLDER_SPAM_HIGH
    );
  });

  test('AI_ENABLED=true: an authenticated whitelisted clean-tier message is never sent to AI and stays clean', async () => {
    const ctx = fixtureContext({
      config: { AI_ENABLED: true, SPAM_PROCESSING_MODE: 'folder' },
    });
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    fakeStateManager.readMapState.mockImplementation((imap, key) =>
      key === ctx.config.STATE_KEY_WHITELIST_MAP ? ['trusted@example.com'] : []
    );
    fakeImapClient.search.mockResolvedValue([101]);
    fakeImapClient.fetchMessagesByUIDs.mockResolvedValue([
      fixtureMessage({ uid: 101, from: 'trusted@example.com' }),
    ]);
    fakeRspamdClient.checkEmail.mockResolvedValue(
      fixtureRspamdCheck({ score: 1, required: 15, authenticated: true })
    );

    await runScan({}, ctx);

    expect(fakeAiClient.classifyEmail).not.toHaveBeenCalled();
    // Stays in a clean-tier outcome: never appears in the low-spam-folder move call.
    const lowSpamCall = fakeImapClient.moveMessages.mock.calls.find(
      call => call[2] === ctx.config.FOLDER_SPAM_LOW
    );
    expect(lowSpamCall[1]).toEqual([]);
  });

  test('AI_ENABLED=true: an unauthenticated whitelisted clean-tier message is still sent to AI', async () => {
    const ctx = fixtureContext({
      config: { AI_ENABLED: true, SPAM_PROCESSING_MODE: 'folder' },
    });
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    fakeStateManager.readMapState.mockImplementation((imap, key) =>
      key === ctx.config.STATE_KEY_WHITELIST_MAP ? ['trusted@example.com'] : []
    );
    fakeImapClient.search.mockResolvedValue([101]);
    fakeImapClient.fetchMessagesByUIDs.mockResolvedValue([
      fixtureMessage({ uid: 101, from: 'trusted@example.com' }),
    ]);
    // No `symbols` - rspamd found no passing DKIM/DMARC, so the whitelist
    // match is untrusted and must not exempt this message from AI.
    fakeRspamdClient.checkEmail.mockResolvedValue(
      fixtureRspamdCheck({ score: 1, required: 15 })
    );

    await runScan({}, ctx);

    expect(fakeAiClient.classifyEmail).toHaveBeenCalled();
  });
});

describe('AI failure alert wiring', () => {
  test('repeated AI failures crossing the threshold post an alert to FOLDER_INBOX and train rspamd on it', async () => {
    const ctx = fixtureContext({
      config: {
        AI_ENABLED: true,
        AI_FAILURE_ALERT_THRESHOLD: 1,
        FOLDER_INBOX: 'INBOX',
      },
    });
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    fakeImapClient.search.mockResolvedValue([101]);
    fakeImapClient.fetchMessagesByUIDs.mockResolvedValue([
      fixtureMessage({ uid: 101 }),
    ]);
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });
    fakeAiClient.classifyEmail.mockRejectedValue(new Error('provider timeout'));

    await runScan({}, ctx);

    expect(fakeImapClient.appendMessage).toHaveBeenCalledTimes(1);
    const [, folderArg, rawArg] = fakeImapClient.appendMessage.mock.calls[0];
    expect(folderArg).toBe('INBOX');
    expect(rawArg).toContain('provider timeout');
    expect(fakeRspamdClient.learnHam).toHaveBeenCalledWith(rawArg);
  });

  test('appendMessage failure does not abort the batch', async () => {
    const ctx = fixtureContext({
      config: { AI_ENABLED: true, AI_FAILURE_ALERT_THRESHOLD: 1 },
    });
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    fakeImapClient.search.mockResolvedValue([101]);
    fakeImapClient.fetchMessagesByUIDs.mockResolvedValue([
      fixtureMessage({ uid: 101 }),
    ]);
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });
    fakeAiClient.classifyEmail.mockRejectedValue(new Error('provider timeout'));
    fakeImapClient.appendMessage.mockRejectedValue(
      new Error('IMAP append failed')
    );

    const result = await runScan({}, ctx);

    expect(result).toEqual({ processed: 1, last_uid: 101 });
    expect(fakeRspamdClient.learnHam).not.toHaveBeenCalled();
  });
});

describe('UIDVALIDITY tracking', () => {
  test('mismatched uid_validity: resets to UIDNEXT - 1 instead of the stale last_uid', async () => {
    const ctx = fixtureContext();
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: 9000,
      last_seen_date: '',
      last_checked: '',
      uid_validity: '111',
    });
    // New epoch: server only has 5 messages now (UIDNEXT 6), nothing new yet.
    fakeImapClient.open.mockResolvedValue({ uidValidity: 222n, uidNext: 6 });
    fakeImapClient.search.mockResolvedValue([]);

    const result = await runScan({}, ctx);

    expect(fakeImapClient.fetchMessagesByUIDs).not.toHaveBeenCalled();
    expect(result).toEqual({ processed: 0, last_uid: 5 });
    // Persisted immediately even though nothing new was found, so the next
    // cycle doesn't re-detect the same mismatch and warn again.
    expect(fakeStateManager.writeScannerState).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ last_uid: 5, uid_validity: '222' })
    );
  });
});

describe('processing mode', () => {
  test('an unknown SPAM_PROCESSING_MODE throws', async () => {
    const ctx = fixtureContext({ config: { SPAM_PROCESSING_MODE: 'invalid' } });
    fakeStateManager.readScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    fakeImapClient.search.mockResolvedValue([101]);
    fakeImapClient.fetchMessagesByUIDs.mockResolvedValue([
      fixtureMessage({ uid: 101 }),
    ]);
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });

    await expect(runScan({}, ctx)).rejects.toThrow('Unknown processing mode');
  });
});
