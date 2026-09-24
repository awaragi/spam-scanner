import { vi } from 'vitest';
import { fixtureRspamdCheck, fixtureAiResult } from './fixtures.ts';

export function createFakeImapClient() {
  return {
    open: vi.fn().mockResolvedValue({ uidValidity: 1n, uidNext: 1 }),
    search: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockReturnValue(0),
    fetchMessagesByUIDs: vi.fn().mockResolvedValue([]),
    fetchMessageHeadersByUIDs: vi.fn().mockResolvedValue([]),
    moveMessages: vi.fn().mockResolvedValue(undefined),
    appendMessage: vi.fn().mockResolvedValue(undefined),
    updateLabels: vi.fn().mockResolvedValue(undefined),
    createAppFolders: vi.fn().mockResolvedValue(undefined),
    waitForNewMail: vi.fn().mockResolvedValue(undefined),
  };
}

export function createFakeRspamdClient() {
  return {
    checkEmail: vi.fn().mockResolvedValue(fixtureRspamdCheck()),
    learnSpam: vi.fn().mockResolvedValue(undefined),
    learnHam: vi.fn().mockResolvedValue(undefined),
  };
}

export function createFakeAiClient() {
  return { classifyEmail: vi.fn().mockResolvedValue(fixtureAiResult()) };
}

export function createFakeStateManagerClient() {
  return {
    readScannerState: vi
      .fn()
      .mockResolvedValue({ last_uid: 0, last_seen_date: '', last_checked: '' }),
    writeScannerState: vi.fn().mockResolvedValue(true),
    readMapState: vi.fn().mockResolvedValue([]),
    writeMapState: vi.fn().mockResolvedValue(true),
    deleteScannerState: vi.fn().mockResolvedValue(false),
  };
}

export function createFakeFolderResolverClient() {
  return { resolveFolders: vi.fn().mockResolvedValue(undefined) };
}
