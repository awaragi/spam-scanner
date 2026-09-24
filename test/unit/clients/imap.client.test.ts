import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ImapFlow } from 'imapflow';

const { fakeConfig, fakeImapFlow } = vi.hoisted(() => ({
  fakeConfig: {},
  fakeImapFlow: vi.fn(),
}));
vi.mock('../../../src/lib/core/config.ts', () => ({ config: fakeConfig }));
vi.mock('../../../src/lib/core/logger.ts', () => {
  interface NoOpLogger {
    debug: ReturnType<typeof vi.fn>;
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    fatal: ReturnType<typeof vi.fn>;
    trace: ReturnType<typeof vi.fn>;
    forMessage?: () => NoOpLogger;
  }
  const noOpLogger: NoOpLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  };
  noOpLogger.forMessage = () => noOpLogger;
  return {
    rootLogger: {
      forComponent: () => noOpLogger,
    },
  };
});
vi.mock('imapflow', () => ({ ImapFlow: fakeImapFlow }));

import {
  newClient,
  safeLogout,
  waitForNewMail,
  processMessage,
  processMessageHeaders,
  fetchMessageHeadersByUIDs,
} from '../../../src/lib/clients/imap.client.ts';

describe('newClient', () => {
  beforeEach(() => {
    fakeImapFlow.mockClear();
  });

  test('sets doSTARTTLS: true when IMAP_TLS is false', () => {
    Object.assign(fakeConfig, { IMAP_TLS: false });

    newClient();

    expect(fakeImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, doSTARTTLS: true })
    );
  });

  test('leaves doSTARTTLS unset when IMAP_TLS is true', () => {
    Object.assign(fakeConfig, { IMAP_TLS: true });

    newClient();

    expect(fakeImapFlow).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, doSTARTTLS: undefined })
    );
  });
});

describe('processMessageHeaders', () => {
  test('parses headers from a header buffer that already ends in a blank line', () => {
    const message = {
      uid: 1,
      headers: Buffer.from('From: a@example.com\r\nSubject: hi\r\n\r\n'),
    };

    const result = processMessageHeaders(message);

    expect(result).toEqual({
      uid: 1,
      headers: { from: 'a@example.com', subject: 'hi' },
    });
  });

  test('parses headers from a header buffer with no trailing blank line', () => {
    // Some servers' BODY[HEADER] response omits the trailing CRLFCRLF -
    // processMessageHeaders must still find the header/body boundary.
    const message = {
      uid: 2,
      headers: Buffer.from('From: b@example.com\r\nSubject: bye'),
    };

    const result = processMessageHeaders(message);

    expect(result).toEqual({
      uid: 2,
      headers: { from: 'b@example.com', subject: 'bye' },
    });
  });
});

describe('processMessage', () => {
  test('returns raw as a Buffer with X-Spam headers stripped', () => {
    const source = Buffer.from(
      'From: a@example.com\nX-Spam-Flag: YES\n\nBody',
      'latin1'
    );
    const message = {
      uid: 5,
      flags: ['\\Seen'],
      envelope: { subject: 'hi' },
      source,
    };

    const result = processMessage(message);

    expect(Buffer.isBuffer(result.raw)).toBe(true);
    expect(result).toEqual({
      uid: 5,
      flags: ['\\Seen'],
      envelope: { subject: 'hi' },
      raw: Buffer.from('From: a@example.com\n\nBody', 'latin1'),
    });
  });

  test('preserves non-UTF-8 8-bit body bytes rather than corrupting them', () => {
    const header = Buffer.from('Subject: hi\r\n\r\n', 'latin1');
    const body = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "caf" + invalid-UTF-8 0xE9
    const message = {
      uid: 6,
      flags: [],
      envelope: {},
      source: Buffer.concat([header, body]),
    };

    const result = processMessage(message);
    const resultBody = result.raw.subarray(result.raw.length - body.length);

    expect(Buffer.compare(resultBody, body)).toBe(0);
  });
});

describe('fetchMessageHeadersByUIDs', () => {
  test('fetches only headers (never source/envelope/bodyStructure) and maps results through processMessageHeaders', async () => {
    async function* fakeFetch() {
      yield {
        uid: 1,
        headers: Buffer.from('From: a@example.com\r\n\r\n'),
      };
      yield {
        uid: 2,
        headers: Buffer.from('From: b@example.com\r\n\r\n'),
      };
    }
    const mockImap = { fetch: vi.fn().mockReturnValue(fakeFetch()) };

    const result = await fetchMessageHeadersByUIDs(
      mockImap as unknown as ImapFlow,
      [1, 2]
    );

    expect(mockImap.fetch).toHaveBeenCalledWith(
      { uid: '1,2' },
      { uid: true, headers: true },
      { uid: true }
    );
    expect(result).toEqual([
      { uid: 1, headers: { from: 'a@example.com' } },
      { uid: 2, headers: { from: 'b@example.com' } },
    ]);
  });
});

describe('safeLogout', () => {
  test('calls imap.logout()', async () => {
    const imap = { logout: vi.fn().mockResolvedValue(undefined) };
    await safeLogout(imap as unknown as ImapFlow);
    expect(imap.logout).toHaveBeenCalled();
  });

  test('swallows a logout failure rather than throwing (e.g. connect() never succeeded)', async () => {
    const imap = {
      logout: vi.fn().mockRejectedValue(new Error('no connection')),
    };
    await expect(
      safeLogout(imap as unknown as ImapFlow)
    ).resolves.toBeUndefined();
  });
});

describe('waitForNewMail', () => {
  interface MockLock {
    release: ReturnType<typeof vi.fn>;
  }
  interface MockImap {
    getMailboxLock: ReturnType<typeof vi.fn>;
    mailbox: { exists: number; uidNext?: number };
    once: ReturnType<typeof vi.fn>;
    off: ReturnType<typeof vi.fn>;
    idle: ReturnType<typeof vi.fn>;
  }

  let mockLock: MockLock;
  let mockImap: MockImap;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLock = { release: vi.fn() };
    mockImap = {
      getMailboxLock: vi.fn().mockResolvedValue(mockLock),
      mailbox: { exists: 0 },
      once: vi
        .fn()
        .mockImplementation((event: string, cb: (arg?: unknown) => void) => {
          if (event === 'exists') cb({});
        }),
      off: vi.fn(),
      idle: vi.fn().mockResolvedValue(undefined),
    };
  });

  test('acquires the mailbox lock in read-only mode', async () => {
    await waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX');

    expect(mockImap.getMailboxLock).toHaveBeenCalledWith('INBOX', {
      readOnly: true,
    });
  });

  test('registers exists and error listeners before acquiring the lock', async () => {
    const callOrder: string[] = [];
    mockImap.once.mockImplementation((event, cb) => {
      callOrder.push(`once:${event}`);
      if (event === 'exists') cb({});
    });
    mockImap.getMailboxLock.mockImplementation(() => {
      callOrder.push('getMailboxLock');
      return Promise.resolve(mockLock);
    });

    await waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX');

    expect(callOrder.indexOf('once:exists')).toBeLessThan(
      callOrder.indexOf('getMailboxLock')
    );
    expect(callOrder.indexOf('once:error')).toBeLessThan(
      callOrder.indexOf('getMailboxLock')
    );
  });

  test('enters IDLE immediately after acquiring the lock', async () => {
    await waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX');

    expect(mockImap.idle).toHaveBeenCalledOnce();
  });

  test('releases the lock and removes listeners after idle resolves', async () => {
    await waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX');

    expect(mockLock.release).toHaveBeenCalledOnce();
    expect(mockImap.off).toHaveBeenCalledWith('exists', expect.any(Function));
    expect(mockImap.off).toHaveBeenCalledWith('error', expect.any(Function));
  });

  test('cleans up listeners and does not release lock when getMailboxLock throws', async () => {
    mockImap.once.mockImplementation(() => {}); // don't auto-resolve
    mockImap.getMailboxLock.mockRejectedValue(new Error('connection lost'));

    await expect(waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX')).rejects.toThrow(
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

    await expect(waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX')).rejects.toThrow(
      'socket closed'
    );

    expect(mockLock.release).toHaveBeenCalledOnce();
  });

  test('rejects when the connection emits close while waiting (silent disconnect)', async () => {
    mockImap.once.mockImplementation((event, cb) => {
      if (event === 'close') cb();
    });

    await expect(waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX')).rejects.toThrow(
      'IMAP connection closed while waiting for EXISTS'
    );

    expect(mockLock.release).toHaveBeenCalledOnce();
  });

  describe('watchdog', () => {
    test('resolves on its own after watchdogMs elapses with no activity', async () => {
      mockImap.once.mockImplementation(() => {}); // never fires naturally

      await waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX', { watchdogMs: 10 });

      expect(mockLock.release).toHaveBeenCalledOnce();
    });

    test('watchdogMs: 0 disables the watchdog (default test config has no activity, so this would hang if not for the test-level cb)', async () => {
      await waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX', { watchdogMs: 0 });

      expect(mockLock.release).toHaveBeenCalledOnce();
    });
  });

  describe('pre-IDLE catch-up', () => {
    test('skips IDLE and returns immediately when mail already arrived before the lock was acquired', async () => {
      mockImap.once.mockImplementation(() => {}); // would hang if catch-up didn't short-circuit
      mockImap.mailbox = { exists: 5, uidNext: 10 };

      await waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX', { lastUid: 5, watchdogMs: 0 });

      expect(mockImap.idle).not.toHaveBeenCalled();
      expect(mockLock.release).toHaveBeenCalledOnce();
    });

    test('enters IDLE normally when lastUid is already caught up with the mailbox', async () => {
      mockImap.mailbox = { exists: 5, uidNext: 10 };

      await waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX', { lastUid: 9 });

      expect(mockImap.idle).toHaveBeenCalledOnce();
    });

    test('ignores a non-numeric lastUid and enters IDLE normally', async () => {
      mockImap.mailbox = { exists: 5, uidNext: 10 };

      await waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX', { lastUid: undefined });

      expect(mockImap.idle).toHaveBeenCalledOnce();
    });
  });

  describe('abort signal', () => {
    test('resolves immediately without entering IDLE when the signal is already aborted', async () => {
      mockImap.once.mockImplementation(() => {}); // would hang if abort wasn't honored
      const controller = new AbortController();
      controller.abort();

      await waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX', {
        signal: controller.signal,
        watchdogMs: 0,
      });

      expect(mockImap.idle).not.toHaveBeenCalled();
      expect(mockLock.release).toHaveBeenCalledOnce();
    });

    test('resolves (not rejects) when the signal aborts while waiting in IDLE', async () => {
      mockImap.once.mockImplementation(() => {}); // never fires naturally
      const controller = new AbortController();

      const promise = waitForNewMail(mockImap as unknown as ImapFlow, 'INBOX', {
        signal: controller.signal,
        watchdogMs: 0,
      });
      controller.abort();

      await expect(promise).resolves.toBeUndefined();
      expect(mockLock.release).toHaveBeenCalledOnce();
    });
  });
});
