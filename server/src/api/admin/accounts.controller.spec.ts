import { describe, test, expect, vi } from 'vitest';
import type { Response } from 'express';
import { AccountsController } from './accounts.controller.js';
import type { AccountAdminService } from '../../application/accounts/account-admin.service.js';
import type { RunnerRegistry } from '../../runtime/runner-registry.js';
import { PreconditionRequiredException } from '../common/http-exceptions.js';

function fixtureMailbox() {
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
  };
}

function fixtureListing(version = 1) {
  return {
    version,
    accounts: [
      {
        id: 'owner@example.com',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'owner@example.com',
        imapTls: true,
        imapAllowInsecure: false,
        stateFolder: 'INBOX.scanner.state',
        enabled: true,
        aiEnabled: true,
      },
    ],
  };
}

function fixtureResponse(): Response {
  return { setHeader: vi.fn() } as unknown as Response;
}

function build() {
  const accountAdminService = {
    list: vi.fn().mockResolvedValue(fixtureListing()),
    create: vi.fn().mockResolvedValue({
      listing: fixtureListing(2),
      mailbox: fixtureMailbox(),
    }),
    update: vi.fn().mockResolvedValue({
      listing: fixtureListing(2),
      mailbox: fixtureMailbox(),
    }),
    delete: vi.fn().mockResolvedValue(fixtureListing(2)),
  };
  const runnerRegistry = {
    registerAccount: vi.fn(),
    updateAccount: vi.fn().mockResolvedValue(undefined),
    removeAccount: vi.fn().mockResolvedValue(undefined),
  };

  const controller = new AccountsController(
    accountAdminService as unknown as AccountAdminService,
    runnerRegistry as unknown as RunnerRegistry,
  );

  return { controller, accountAdminService, runnerRegistry };
}

describe('AccountsController', () => {
  test('GET sets the ETag header to the quoted file version', async () => {
    const { controller } = build();
    const res = fixtureResponse();

    const listing = await controller.list(res);

    expect(listing.version).toBe(1);
    expect(res.setHeader).toHaveBeenCalledWith('ETag', '"1"');
  });

  test('POST without If-Match rejects with 428, before the service runs', async () => {
    const { controller, accountAdminService } = build();
    const res = fixtureResponse();

    await expect(
      controller.create({} as never, undefined, res),
    ).rejects.toThrow(PreconditionRequiredException);
    expect(accountAdminService.create).not.toHaveBeenCalled();
  });

  test('PATCH without If-Match rejects with 428, before the service runs', async () => {
    const { controller, accountAdminService } = build();
    const res = fixtureResponse();

    await expect(
      controller.update('owner@example.com', {}, undefined, res),
    ).rejects.toThrow(PreconditionRequiredException);
    expect(accountAdminService.update).not.toHaveBeenCalled();
  });

  test('DELETE without If-Match rejects with 428, before the service runs', async () => {
    const { controller, accountAdminService } = build();
    const res = fixtureResponse();

    await expect(
      controller.remove('owner@example.com', undefined, res),
    ).rejects.toThrow(PreconditionRequiredException);
    expect(accountAdminService.delete).not.toHaveBeenCalled();
  });

  test('a malformed If-Match header (not a quoted integer) also rejects with 428', async () => {
    const { controller } = build();
    const res = fixtureResponse();

    await expect(
      controller.update('owner@example.com', {}, 'not-a-version', res),
    ).rejects.toThrow(PreconditionRequiredException);
  });
});
