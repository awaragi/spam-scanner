import { describe, test, expect, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MailboxController } from './mailbox.controller.js';
import type { RunnerRegistry } from '../../runtime/runner-registry.js';
import type { MailboxAdminService } from '../../application/mailbox-admin/mailbox-admin.service.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { settingsUpdateSchema } from './settings-update.schema.js';
import { listReplaceSchema } from './list-replace.schema.js';

const MAILBOX_ID = 'owner@example.com';

function build() {
  const runnerRegistry = {
    triggerNow: vi.fn().mockResolvedValue(undefined),
    triggerInitFolders: vi.fn().mockResolvedValue(undefined),
    getMailboxStatus: vi.fn().mockReturnValue({ mailboxId: MAILBOX_ID }),
  };
  const mailboxAdminService = {
    readList: vi.fn().mockResolvedValue(['a@example.com']),
  };

  const controller = new MailboxController(
    runnerRegistry as unknown as RunnerRegistry,
    mailboxAdminService as unknown as MailboxAdminService,
  );

  return { controller, runnerRegistry, mailboxAdminService };
}

const UNKNOWN_MAILBOX_ERROR = new Error(`Unknown mailbox: ${MAILBOX_ID}`);

describe('MailboxController', () => {
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
  });
});
