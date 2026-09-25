import { describe, test, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import pino from 'pino';
import { PinoLogger } from 'nestjs-pino';
import { asImapFlow } from '../../../test/support/imap-fakes.js';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';
import { MailboxRepository } from '../../infrastructure/mailboxes/mailbox.repository.js';
import {
  STATE_KEY_WHITELIST_MAP,
  STATE_KEY_BLACKLIST_MAP,
} from '../../domain/state/state-format.js';

const { mockNewClient, mockSafeLogout, mockReadScannerState, mockDeleteScannerState, mockReadMapState, mockWriteMapState } =
  vi.hoisted(() => ({
    mockNewClient: vi.fn(),
    mockSafeLogout: vi.fn(),
    mockReadScannerState: vi.fn(),
    mockDeleteScannerState: vi.fn(),
    mockReadMapState: vi.fn(),
    mockWriteMapState: vi.fn(),
  }));

vi.mock('../../infrastructure/imap/imap-connection.factory.js', () => ({
  newClient: mockNewClient,
  safeLogout: mockSafeLogout,
}));

vi.mock('../../infrastructure/state/scanner-state.repository.js', () => ({
  readScannerState: mockReadScannerState,
  deleteScannerState: mockDeleteScannerState,
}));

vi.mock('../../infrastructure/state/sender-list.repository.js', () => ({
  readMapState: mockReadMapState,
  writeMapState: mockWriteMapState,
}));

// Imported after the mocks above, per this codebase's existing convention
// (see mailbox-runner.spec.ts/runner-registry.spec.ts).
import { MailboxAdminService } from './mailbox-admin.service.js';

function fixtureMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'owner@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapUser: 'owner@example.com',
    imapPassword: 'secret',
    imapTls: true,
    imapAllowInsecure: false,
    stateFolder: 'INBOX.scanner.state',
    ...overrides,
  };
}

function fixtureImap(overrides: { connect?: ReturnType<typeof vi.fn> } = {}) {
  return asImapFlow({
    usable: true,
    connect: overrides.connect ?? vi.fn().mockResolvedValue(undefined),
  });
}

function fixturePinoLogger(): PinoLogger {
  return {
    logger: pino({ enabled: false }),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  } as unknown as PinoLogger;
}

function buildService(
  options: { mailboxes?: Mailbox[] } = {},
): MailboxAdminService {
  const mailboxes = options.mailboxes ?? [fixtureMailbox()];
  const mailboxRepository = {
    findAll: () => mailboxes,
  } as unknown as MailboxRepository;
  return new MailboxAdminService(mailboxRepository, fixturePinoLogger());
}

describe('MailboxAdminService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNewClient.mockImplementation(() => fixtureImap());
    mockSafeLogout.mockResolvedValue(undefined);
  });

  describe('withConnection (via any public method)', () => {
    test('logs out even when the underlying call throws', async () => {
      mockReadScannerState.mockRejectedValue(new Error('boom'));
      const service = buildService();

      await expect(service.readState('owner@example.com')).rejects.toThrow(
        'boom',
      );

      expect(mockSafeLogout).toHaveBeenCalledTimes(1);
    });

    test('an unknown mailbox throws NotFoundException without opening a connection', async () => {
      const service = buildService();

      await expect(
        service.readState('does-not-exist@example.com'),
      ).rejects.toThrow(NotFoundException);

      expect(mockNewClient).not.toHaveBeenCalled();
    });
  });

  describe('readState()', () => {
    test('returns the scanner state when one exists', async () => {
      const state = {
        last_uid: 42,
        last_seen_date: '2024-01-01T00:00:00.000Z',
        last_checked: '2024-01-01T00:00:00.000Z',
      };
      mockReadScannerState.mockResolvedValue(state);
      const service = buildService();

      const result = await service.readState('owner@example.com');

      expect(result).toEqual(state);
      expect(mockReadScannerState).toHaveBeenCalledWith(
        expect.anything(),
        'INBOX.scanner.state',
      );
    });

    test('returns null when no state exists', async () => {
      mockReadScannerState.mockRejectedValue(
        new Error('Scanner state not found'),
      );
      const service = buildService();

      const result = await service.readState('owner@example.com');

      expect(result).toBeNull();
      expect(mockSafeLogout).toHaveBeenCalledTimes(1);
    });
  });

  describe('resetState()', () => {
    test('delegates to deleteScannerState', async () => {
      mockDeleteScannerState.mockResolvedValue(true);
      const service = buildService();

      const result = await service.resetState('owner@example.com');

      expect(result).toBe(true);
      expect(mockDeleteScannerState).toHaveBeenCalledWith(
        expect.anything(),
        'INBOX.scanner.state',
        expect.anything(),
      );
    });
  });

  describe('readList()/replaceList()', () => {
    test('readList uses the whitelist key for kind "whitelist"', async () => {
      mockReadMapState.mockResolvedValue(['a@example.com']);
      const service = buildService();

      const result = await service.readList('owner@example.com', 'whitelist');

      expect(result).toEqual(['a@example.com']);
      expect(mockReadMapState).toHaveBeenCalledWith(
        expect.anything(),
        'INBOX.scanner.state',
        STATE_KEY_WHITELIST_MAP,
        expect.anything(),
      );
    });

    test('readList uses the blacklist key for kind "blacklist"', async () => {
      mockReadMapState.mockResolvedValue(['b@example.com']);
      const service = buildService();

      await service.readList('owner@example.com', 'blacklist');

      expect(mockReadMapState).toHaveBeenCalledWith(
        expect.anything(),
        'INBOX.scanner.state',
        STATE_KEY_BLACKLIST_MAP,
        expect.anything(),
      );
    });

    test('replaceList writes the whitelist key for kind "whitelist"', async () => {
      mockWriteMapState.mockResolvedValue(true);
      const service = buildService();

      await service.replaceList('owner@example.com', 'whitelist', [
        'c@example.com',
      ]);

      expect(mockWriteMapState).toHaveBeenCalledWith(
        expect.anything(),
        'INBOX.scanner.state',
        STATE_KEY_WHITELIST_MAP,
        ['c@example.com'],
        expect.anything(),
      );
    });

    test('replaceList writes the blacklist key for kind "blacklist"', async () => {
      mockWriteMapState.mockResolvedValue(true);
      const service = buildService();

      await service.replaceList('owner@example.com', 'blacklist', [
        'd@example.com',
      ]);

      expect(mockWriteMapState).toHaveBeenCalledWith(
        expect.anything(),
        'INBOX.scanner.state',
        STATE_KEY_BLACKLIST_MAP,
        ['d@example.com'],
        expect.anything(),
      );
    });
  });
});
