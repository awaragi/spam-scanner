import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import pino from 'pino';
import { PinoLogger } from 'nestjs-pino';
import { VersionConflict } from '../../infrastructure/accounts/account-store.js';
import type { AccountStore } from '../../infrastructure/accounts/account-store.js';
import type { AccountRecord } from '../../infrastructure/accounts/account-record.js';
import type { CreateAccountInput } from './account-admin.dto.js';

const { mockTestImapConnection } = vi.hoisted(() => ({
  mockTestImapConnection: vi.fn(),
}));

vi.mock('../../infrastructure/accounts/imap-connection-test.js', () => ({
  testImapConnection: mockTestImapConnection,
}));

import { AccountAdminService } from './account-admin.service.js';

function fixtureAccount(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: 'owner@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapUser: 'owner@example.com',
    imapPassword: 'secret',
    imapTls: true,
    imapAllowInsecure: false,
    stateFolder: 'INBOX.scanner.state',
    enabled: true,
    aiEnabled: true,
    ...overrides,
  };
}

function fixtureCreateInput(
  overrides: Partial<CreateAccountInput> = {},
): CreateAccountInput {
  return { ...fixtureAccount(), ...overrides };
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

function fakeStore(initial: { version: number; accounts: AccountRecord[] }) {
  let state = initial;
  return {
    load: vi.fn(async () => state),
    save: vi.fn(async (expectedVersion: number, accounts: AccountRecord[]) => {
      if (state.version !== expectedVersion) {
        throw new VersionConflict(state.version);
      }
      state = { version: state.version + 1, accounts: [...accounts] };
      return state;
    }),
  };
}

function buildService(
  store: ReturnType<typeof fakeStore>,
): AccountAdminService {
  return new AccountAdminService(
    store as unknown as AccountStore,
    fixturePinoLogger(),
  );
}

describe('AccountAdminService', () => {
  beforeEach(() => {
    mockTestImapConnection.mockReset().mockResolvedValue(undefined);
  });

  describe('create()', () => {
    test('rejects a duplicate id before testing the IMAP connection', async () => {
      const store = fakeStore({ version: 1, accounts: [fixtureAccount()] });
      const service = buildService(store);

      await expect(service.create(fixtureCreateInput(), 1)).rejects.toThrow(
        ConflictException,
      );

      expect(mockTestImapConnection).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();
    });

    test('tests the IMAP connection before saving, then returns the new mailbox and listing', async () => {
      const store = fakeStore({ version: 0, accounts: [] });
      const service = buildService(store);
      const input = fixtureCreateInput({ id: 'new@example.com' });

      const result = await service.create(input, 0);

      expect(mockTestImapConnection).toHaveBeenCalledTimes(1);
      expect(store.save).toHaveBeenCalledTimes(1);
      expect(result.mailbox.id).toBe('new@example.com');
      expect(result.listing.version).toBe(1);
      expect(result.listing.accounts[0]).not.toHaveProperty('imapPassword');
    });

    test('a failed IMAP test rejects and never writes the store', async () => {
      const store = fakeStore({ version: 0, accounts: [] });
      mockTestImapConnection.mockRejectedValue(new Error('connect refused'));
      const service = buildService(store);

      await expect(service.create(fixtureCreateInput(), 0)).rejects.toThrow(
        'connect refused',
      );

      expect(store.save).not.toHaveBeenCalled();
    });

    test('rejects imapTls=false with no imapAllowInsecure opt-in, without testing the connection', async () => {
      const store = fakeStore({ version: 0, accounts: [] });
      const service = buildService(store);

      await expect(
        service.create(
          fixtureCreateInput({ imapTls: false, imapAllowInsecure: false }),
          0,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(mockTestImapConnection).not.toHaveBeenCalled();
    });

    test('a stale If-Match version is rejected as ConflictException, after the IMAP test ran', async () => {
      const store = fakeStore({ version: 2, accounts: [] });
      const service = buildService(store);

      await expect(
        service.create(fixtureCreateInput({ id: 'new@example.com' }), 1),
      ).rejects.toThrow(ConflictException);

      expect(mockTestImapConnection).toHaveBeenCalledTimes(1);
    });
  });

  describe('update()', () => {
    test('an omitted password keeps the stored password', async () => {
      const existing = fixtureAccount({ imapPassword: 'original' });
      const store = fakeStore({ version: 1, accounts: [existing] });
      const service = buildService(store);

      await service.update(
        existing.id,
        { imapHost: 'imap.new.example.com' },
        1,
      );

      expect(mockTestImapConnection).toHaveBeenCalledWith(
        expect.objectContaining({ imapPassword: 'original' }),
        expect.anything(),
      );
    });

    test('throws NotFoundException for an unknown mailbox id', async () => {
      const store = fakeStore({ version: 1, accounts: [] });
      const service = buildService(store);

      await expect(
        service.update('unknown@example.com', {}, 1),
      ).rejects.toThrow(NotFoundException);
      expect(mockTestImapConnection).not.toHaveBeenCalled();
    });

    test('the id field cannot be changed via patch', async () => {
      const existing = fixtureAccount();
      const store = fakeStore({ version: 1, accounts: [existing] });
      const service = buildService(store);

      const result = await service.update(
        existing.id,
        { imapHost: 'imap.new.example.com' } as never,
        1,
      );

      expect(result.mailbox.id).toBe(existing.id);
    });
  });

  describe('setEnabled()', () => {
    test('tests the IMAP connection even for an enabled-only change', async () => {
      const existing = fixtureAccount({ enabled: true });
      const store = fakeStore({ version: 1, accounts: [existing] });
      const service = buildService(store);

      const result = await service.setEnabled(existing.id, false, 1);

      expect(mockTestImapConnection).toHaveBeenCalledTimes(1);
      expect(result.mailbox.enabled).toBe(false);
    });
  });

  describe('delete()', () => {
    test('does not test the IMAP connection', async () => {
      const existing = fixtureAccount();
      const store = fakeStore({ version: 1, accounts: [existing] });
      const service = buildService(store);

      const listing = await service.delete(existing.id, 1);

      expect(mockTestImapConnection).not.toHaveBeenCalled();
      expect(listing.accounts).toHaveLength(0);
    });

    test('throws NotFoundException for an unknown mailbox id, without writing', async () => {
      const store = fakeStore({ version: 1, accounts: [] });
      const service = buildService(store);

      await expect(service.delete('unknown@example.com', 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(store.save).not.toHaveBeenCalled();
    });
  });

  describe('getEnabledState()', () => {
    test('returns the account enabled flag and the file version', async () => {
      const store = fakeStore({
        version: 5,
        accounts: [fixtureAccount({ enabled: false })],
      });
      const service = buildService(store);

      const result = await service.getEnabledState('owner@example.com');

      expect(result).toEqual({ enabled: false, version: 5 });
    });
  });
});
