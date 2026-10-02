import { describe, test, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { MailboxController } from './mailbox.controller.js';
import type { RunnerRegistry } from '../../runtime/runner-registry.js';
import type { MailboxAdminService } from '../../application/mailbox-admin/mailbox-admin.service.js';
import type { AccountAdminService } from '../../application/accounts/account-admin.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { settingsUpdateSchema } from './settings-update.schema.js';
import { listReplaceSchema } from './list-replace.schema.js';
import { mailboxEnabledSchema } from './mailbox-enabled.schema.js';
import { PreconditionRequiredException } from '../common/http-exceptions.js';

const MAILBOX_ID = 'owner@example.com';

function fixtureResponse(): Response {
  return { setHeader: vi.fn() } as unknown as Response;
}

function build() {
  const runnerRegistry = {
    triggerNow: vi.fn().mockResolvedValue(undefined),
    triggerInitFolders: vi.fn().mockResolvedValue(undefined),
    enableMailbox: vi.fn(),
    disableMailbox: vi.fn().mockResolvedValue(undefined),
    getMailboxStatus: vi.fn().mockReturnValue({
      mailboxId: MAILBOX_ID,
      enabled: true,
    }),
    // Runs `fn` through as a real `withRunnerPaused` would, so tests can
    // assert on the wrapped MailboxAdminService call it makes.
    withRunnerPaused: vi.fn((_mailboxId: string, fn: () => Promise<unknown>) =>
      fn(),
    ),
  };
  const mailboxAdminService = {
    readList: vi.fn().mockResolvedValue(['a@example.com']),
    writeState: vi.fn().mockResolvedValue(undefined),
    deleteState: vi.fn().mockResolvedValue(true),
    replaceList: vi.fn().mockResolvedValue(undefined),
  };
  const accountAdminService = {
    getEnabledState: vi.fn().mockResolvedValue({ enabled: true, version: 1 }),
    setEnabled: vi.fn().mockResolvedValue({
      listing: { version: 2, accounts: [] },
      mailbox: { id: MAILBOX_ID },
    }),
  };

  const controller = new MailboxController(
    runnerRegistry as unknown as RunnerRegistry,
    mailboxAdminService as unknown as MailboxAdminService,
    accountAdminService as unknown as AccountAdminService,
  );

  return {
    controller,
    runnerRegistry,
    mailboxAdminService,
    accountAdminService,
  };
}

const UNKNOWN_MAILBOX_ERROR = new Error(`Unknown mailbox: ${MAILBOX_ID}`);

describe('MailboxController', () => {
  describe('getEnabled', () => {
    test('returns the enabled state and sets the ETag header from the account version', async () => {
      const { controller, accountAdminService } = build();
      const res = fixtureResponse();

      const result = await controller.getEnabled(MAILBOX_ID, res);

      expect(accountAdminService.getEnabledState).toHaveBeenCalledWith(
        MAILBOX_ID,
      );
      expect(result).toEqual({ enabled: true });
      expect(res.setHeader).toHaveBeenCalledWith('ETag', '"1"');
    });
  });

  describe('setEnabled', () => {
    test('rejects without an If-Match header, before AccountAdminService runs', async () => {
      const { controller, accountAdminService } = build();
      const res = fixtureResponse();

      await expect(
        controller.setEnabled(MAILBOX_ID, { enabled: false }, undefined, res),
      ).rejects.toThrow(PreconditionRequiredException);
      expect(accountAdminService.setEnabled).not.toHaveBeenCalled();
    });

    test('disabling delegates to AccountAdminService.setEnabled and syncs the runner registry', async () => {
      const { controller, accountAdminService, runnerRegistry } = build();
      const res = fixtureResponse();

      const result = await controller.setEnabled(
        MAILBOX_ID,
        { enabled: false },
        '"1"',
        res,
      );

      expect(accountAdminService.setEnabled).toHaveBeenCalledWith(
        MAILBOX_ID,
        false,
        1,
      );
      expect(runnerRegistry.disableMailbox).toHaveBeenCalledWith(MAILBOX_ID);
      expect(result).toEqual({ updated: true });
    });

    test('enabling delegates to AccountAdminService.setEnabled with enabled: true and starts a runner', async () => {
      const { controller, accountAdminService, runnerRegistry } = build();
      const res = fixtureResponse();

      const result = await controller.setEnabled(
        MAILBOX_ID,
        { enabled: true },
        '"1"',
        res,
      );

      expect(accountAdminService.setEnabled).toHaveBeenCalledWith(
        MAILBOX_ID,
        true,
        1,
      );
      expect(runnerRegistry.enableMailbox).toHaveBeenCalledWith(MAILBOX_ID);
      expect(result).toEqual({ updated: true });
    });

    test("translates AccountAdminService's NotFoundException for an unknown mailbox", async () => {
      const { controller, accountAdminService } = build();
      accountAdminService.setEnabled.mockRejectedValue(
        new NotFoundException(`Unknown mailbox: ${MAILBOX_ID}`),
      );
      const res = fixtureResponse();

      await expect(
        controller.setEnabled(MAILBOX_ID, { enabled: false }, '"1"', res),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('triggerJob', () => {
    test('maps a coalesced job name to RunnerRegistry.triggerNow', async () => {
      const { controller, runnerRegistry } = build();

      const result = await controller.triggerJob(MAILBOX_ID, 'train-spam');

      expect(runnerRegistry.triggerNow).toHaveBeenCalledWith(
        MAILBOX_ID,
        'trainSpam',
      );
      expect(result).toEqual({ triggered: true });
    });

    test('maps init-folders to RunnerRegistry.triggerInitFolders', async () => {
      const { controller, runnerRegistry } = build();

      const result = await controller.triggerJob(MAILBOX_ID, 'init-folders');

      expect(runnerRegistry.triggerInitFolders).toHaveBeenCalledWith(
        MAILBOX_ID,
      );
      expect(result).toEqual({ triggered: true });
    });

    test('rejects an unknown job name as BadRequestException without calling the registry', async () => {
      const { controller, runnerRegistry } = build();

      await expect(
        controller.triggerJob(MAILBOX_ID, 'not-a-job'),
      ).rejects.toThrow(BadRequestException);
      expect(runnerRegistry.triggerNow).not.toHaveBeenCalled();
      expect(runnerRegistry.triggerInitFolders).not.toHaveBeenCalled();
    });

    test("translates the registry's async Unknown mailbox rejection to NotFoundException", async () => {
      const { controller, runnerRegistry } = build();
      runnerRegistry.triggerNow.mockRejectedValue(UNKNOWN_MAILBOX_ERROR);

      await expect(controller.triggerJob(MAILBOX_ID, 'scan')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  test("translates the registry's sync Unknown mailbox throw to NotFoundException", () => {
    const { controller, runnerRegistry } = build();
    runnerRegistry.getMailboxStatus.mockImplementation(() => {
      throw UNKNOWN_MAILBOX_ERROR;
    });

    expect(() => controller.getStatus(MAILBOX_ID)).toThrow(NotFoundException);
  });

  test('an unknown list :kind is rejected as BadRequestException before any collaborator is called', async () => {
    const { controller, mailboxAdminService } = build();

    await expect(controller.readList(MAILBOX_ID, 'greylist')).rejects.toThrow(
      BadRequestException,
    );
    expect(mailboxAdminService.readList).not.toHaveBeenCalled();
  });

  describe('paused writes (writeState/deleteState/replaceList/importList)', () => {
    const stateBody = { last_uid: 1, last_seen_date: 'a', last_checked: 'b' };

    test('writeState runs through RunnerRegistry.withRunnerPaused before calling MailboxAdminService', async () => {
      const { controller, runnerRegistry, mailboxAdminService } = build();

      const result = await controller.writeState(MAILBOX_ID, stateBody);

      expect(runnerRegistry.withRunnerPaused).toHaveBeenCalledWith(
        MAILBOX_ID,
        expect.any(Function),
      );
      expect(mailboxAdminService.writeState).toHaveBeenCalledWith(
        MAILBOX_ID,
        stateBody,
      );
      expect(result).toEqual({ written: true });
    });

    test('deleteState runs through RunnerRegistry.withRunnerPaused', async () => {
      const { controller, runnerRegistry, mailboxAdminService } = build();

      const result = await controller.deleteState(MAILBOX_ID);

      expect(runnerRegistry.withRunnerPaused).toHaveBeenCalledWith(
        MAILBOX_ID,
        expect.any(Function),
      );
      expect(mailboxAdminService.deleteState).toHaveBeenCalledWith(MAILBOX_ID);
      expect(result).toEqual({ deleted: true });
    });

    test('replaceList and importList both run through RunnerRegistry.withRunnerPaused', async () => {
      const { controller, runnerRegistry, mailboxAdminService } = build();
      const addresses = ['a@example.com'];

      const replaced = await controller.replaceList(
        MAILBOX_ID,
        'whitelist',
        addresses,
      );
      const imported = await controller.importList(
        MAILBOX_ID,
        'blacklist',
        addresses,
      );

      expect(runnerRegistry.withRunnerPaused).toHaveBeenCalledTimes(2);
      expect(mailboxAdminService.replaceList).toHaveBeenCalledWith(
        MAILBOX_ID,
        'whitelist',
        addresses,
      );
      expect(mailboxAdminService.replaceList).toHaveBeenCalledWith(
        MAILBOX_ID,
        'blacklist',
        addresses,
      );
      expect(replaced).toEqual({ replaced: true });
      expect(imported).toEqual({ imported: true });
    });

    test("translates withRunnerPaused's Unknown mailbox rejection to NotFoundException", async () => {
      const { controller, runnerRegistry } = build();
      runnerRegistry.withRunnerPaused.mockRejectedValue(UNKNOWN_MAILBOX_ERROR);

      await expect(
        controller.writeState(MAILBOX_ID, stateBody),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('route body pipes', () => {
    test('an invalid settings body is rejected', () => {
      const pipe = new ZodValidationPipe(settingsUpdateSchema);

      expect(() =>
        pipe.transform({ thresholds: { clean: 'not-a-number' } }),
      ).toThrow(BadRequestException);
    });

    test('a valid settings body parses unchanged', () => {
      const pipe = new ZodValidationPipe(settingsUpdateSchema);

      expect(pipe.transform({ scanRead: true })).toEqual({ scanRead: true });
    });

    test('an invalid list body is rejected', () => {
      const pipe = new ZodValidationPipe(listReplaceSchema);

      expect(() => pipe.transform(['valid@example.com', ''])).toThrow(
        BadRequestException,
      );
      expect(() => pipe.transform('not-an-array')).toThrow(BadRequestException);
    });

    test('a valid list body parses unchanged', () => {
      const pipe = new ZodValidationPipe(listReplaceSchema);

      expect(pipe.transform(['a@example.com', 'b@example.com'])).toEqual([
        'a@example.com',
        'b@example.com',
      ]);
    });

    test('an invalid enabled body is rejected', () => {
      const pipe = new ZodValidationPipe(mailboxEnabledSchema);

      expect(() => pipe.transform({ enabled: 'no' })).toThrow(
        BadRequestException,
      );
    });
  });
});
