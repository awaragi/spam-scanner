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

  test('POST with a valid If-Match creates the account and registers it with the runner registry', async () => {
    const { controller, accountAdminService, runnerRegistry } = build();
    const res = fixtureResponse();
    const body = { id: 'new@example.com' } as never;

    const listing = await controller.create(body, '"1"', res);

    expect(accountAdminService.create).toHaveBeenCalledWith(body, 1);
    expect(runnerRegistry.registerAccount).toHaveBeenCalledWith(
      fixtureMailbox(),
    );
    expect(listing.version).toBe(2);
    expect(res.setHeader).toHaveBeenCalledWith('ETag', '"2"');
  });

  test('PATCH without If-Match rejects with 428, before the service runs', async () => {
    const { controller, accountAdminService } = build();
    const res = fixtureResponse();

    await expect(
      controller.update('owner@example.com', {}, undefined, res),
    ).rejects.toThrow(PreconditionRequiredException);
    expect(accountAdminService.update).not.toHaveBeenCalled();
  });

  test('PATCH with a valid If-Match updates the account and syncs the runner registry', async () => {
    const { controller, accountAdminService, runnerRegistry } = build();
    const res = fixtureResponse();

    await controller.update(
      'owner@example.com',
      { enabled: false },
      '"1"',
      res,
    );

    expect(accountAdminService.update).toHaveBeenCalledWith(
      'owner@example.com',
      { enabled: false },
      1,
    );
    expect(runnerRegistry.updateAccount).toHaveBeenCalledWith(fixtureMailbox());
  });

  test('DELETE without If-Match rejects with 428, before the service runs', async () => {
    const { controller, accountAdminService } = build();
    const res = fixtureResponse();

    await expect(
      controller.remove('owner@example.com', undefined, res),
    ).rejects.toThrow(PreconditionRequiredException);
    expect(accountAdminService.delete).not.toHaveBeenCalled();
  });

  test('DELETE with a valid If-Match removes the account and stops its runner', async () => {
    const { controller, accountAdminService, runnerRegistry } = build();
    const res = fixtureResponse();

    await controller.remove('owner@example.com', '"1"', res);

    expect(accountAdminService.delete).toHaveBeenCalledWith(
      'owner@example.com',
      1,
    );
    expect(runnerRegistry.removeAccount).toHaveBeenCalledWith(
      'owner@example.com',
    );
  });

  test('a malformed If-Match header (not a quoted integer) also rejects with 428', async () => {
    const { controller } = build();
    const res = fixtureResponse();

    await expect(
      controller.update('owner@example.com', {}, 'not-a-version', res),
    ).rejects.toThrow(PreconditionRequiredException);
  });
});
