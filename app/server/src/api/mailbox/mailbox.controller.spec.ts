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
    getMailboxSettings: vi.fn().mockReturnValue({ scanRead: true }),
    updateSettings: vi.fn().mockResolvedValue(undefined),
  };
  const mailboxAdminService = {
    readState: vi.fn().mockResolvedValue({ last_uid: 1 }),
    resetState: vi.fn().mockResolvedValue(true),
    readList: vi.fn().mockResolvedValue(['a@example.com']),
    replaceList: vi.fn().mockResolvedValue(undefined),
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

    test('translates the registry\'s Unknown mailbox error to NotFoundException', async () => {
      const { controller, runnerRegistry } = build();
      runnerRegistry.triggerNow.mockRejectedValue(UNKNOWN_MAILBOX_ERROR);

      await expect(
        controller.triggerJob(MAILBOX_ID, 'scan'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getStatus', () => {
    test('delegates to RunnerRegistry.getMailboxStatus', () => {
      const { controller, runnerRegistry } = build();

      const result = controller.getStatus(MAILBOX_ID);

      expect(runnerRegistry.getMailboxStatus).toHaveBeenCalledWith(MAILBOX_ID);
      expect(result).toEqual({ mailboxId: MAILBOX_ID });
    });

    test('translates an unknown mailbox to NotFoundException', () => {
      const { controller, runnerRegistry } = build();
      runnerRegistry.getMailboxStatus.mockImplementation(() => {
        throw UNKNOWN_MAILBOX_ERROR;
      });

      expect(() => controller.getStatus(MAILBOX_ID)).toThrow(
        NotFoundException,
      );
    });
  });

  describe('getSettings', () => {
    test('delegates to RunnerRegistry.getMailboxSettings', () => {
      const { controller, runnerRegistry } = build();

      const result = controller.getSettings(MAILBOX_ID);

      expect(runnerRegistry.getMailboxSettings).toHaveBeenCalledWith(
        MAILBOX_ID,
      );
      expect(result).toEqual({ scanRead: true });
    });

    test('translates an unknown mailbox to NotFoundException', () => {
      const { controller, runnerRegistry } = build();
      runnerRegistry.getMailboxSettings.mockImplementation(() => {
        throw UNKNOWN_MAILBOX_ERROR;
      });

      expect(() => controller.getSettings(MAILBOX_ID)).toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateSettings', () => {
    test('delegates the parsed body to RunnerRegistry.updateSettings', async () => {
      const { controller, runnerRegistry } = build();

      const result = await controller.updateSettings(MAILBOX_ID, {
        scanRead: false,
      });

      expect(runnerRegistry.updateSettings).toHaveBeenCalledWith(MAILBOX_ID, {
        scanRead: false,
      });
      expect(result).toEqual({ updated: true });
    });

    test('translates an unknown mailbox to NotFoundException', async () => {
      const { controller, runnerRegistry } = build();
      runnerRegistry.updateSettings.mockRejectedValue(UNKNOWN_MAILBOX_ERROR);

      await expect(
        controller.updateSettings(MAILBOX_ID, {}),
      ).rejects.toThrow(NotFoundException);
    });

    test('an invalid settings body is rejected by the route pipe before the controller runs', () => {
      const pipe = new ZodValidationPipe(settingsUpdateSchema);

      expect(() =>
        pipe.transform({ thresholds: { clean: 'not-a-number' } }),
      ).toThrow(BadRequestException);
    });

    test('a valid settings body parses through the route pipe unchanged', () => {
      const pipe = new ZodValidationPipe(settingsUpdateSchema);

      expect(pipe.transform({ scanRead: true })).toEqual({ scanRead: true });
    });
  });

  describe('getState', () => {
    test('delegates to MailboxAdminService.readState', async () => {
      const { controller, mailboxAdminService } = build();

      const result = await controller.getState(MAILBOX_ID);

      expect(mailboxAdminService.readState).toHaveBeenCalledWith(MAILBOX_ID);
      expect(result).toEqual({ last_uid: 1 });
    });
  });

  describe('resetState', () => {
    test('delegates to MailboxAdminService.resetState', async () => {
      const { controller, mailboxAdminService } = build();

      const result = await controller.resetState(MAILBOX_ID);

      expect(mailboxAdminService.resetState).toHaveBeenCalledWith(MAILBOX_ID);
      expect(result).toEqual({ reset: true });
    });
  });

  describe('readList / exportList', () => {
    test('readList delegates to MailboxAdminService.readList with the parsed kind', async () => {
      const { controller, mailboxAdminService } = build();

      const result = await controller.readList(MAILBOX_ID, 'whitelist');

      expect(mailboxAdminService.readList).toHaveBeenCalledWith(
        MAILBOX_ID,
        'whitelist',
      );
      expect(result).toEqual(['a@example.com']);
    });

    test('exportList delegates to MailboxAdminService.readList with the parsed kind', async () => {
      const { controller, mailboxAdminService } = build();

      const result = await controller.exportList(MAILBOX_ID, 'blacklist');

      expect(mailboxAdminService.readList).toHaveBeenCalledWith(
        MAILBOX_ID,
        'blacklist',
      );
      expect(result).toEqual(['a@example.com']);
    });

    test('an unknown :kind is rejected as BadRequestException before any collaborator is called', async () => {
      const { controller, mailboxAdminService } = build();

      await expect(
        controller.readList(MAILBOX_ID, 'greylist'),
      ).rejects.toThrow(BadRequestException);
      expect(mailboxAdminService.readList).not.toHaveBeenCalled();
    });
  });

  describe('replaceList / importList', () => {
    test('replaceList delegates to MailboxAdminService.replaceList with the parsed kind and body', async () => {
      const { controller, mailboxAdminService } = build();

      const result = await controller.replaceList(MAILBOX_ID, 'whitelist', [
        'a@example.com',
      ]);

      expect(mailboxAdminService.replaceList).toHaveBeenCalledWith(
        MAILBOX_ID,
        'whitelist',
        ['a@example.com'],
      );
      expect(result).toEqual({ replaced: true });
    });

    test('importList delegates to MailboxAdminService.replaceList with the parsed kind and body', async () => {
      const { controller, mailboxAdminService } = build();

      const result = await controller.importList(MAILBOX_ID, 'blacklist', [
        'b@example.com',
      ]);

      expect(mailboxAdminService.replaceList).toHaveBeenCalledWith(
        MAILBOX_ID,
        'blacklist',
        ['b@example.com'],
      );
      expect(result).toEqual({ imported: true });
    });

    test('an unknown :kind is rejected as BadRequestException before any collaborator is called', async () => {
      const { controller, mailboxAdminService } = build();

      await expect(
        controller.replaceList(MAILBOX_ID, 'greylist', ['a@example.com']),
      ).rejects.toThrow(BadRequestException);
      expect(mailboxAdminService.replaceList).not.toHaveBeenCalled();
    });

    test('an invalid list body is rejected by the route pipe before the controller runs', () => {
      const pipe = new ZodValidationPipe(listReplaceSchema);

      expect(() => pipe.transform(['valid@example.com', ''])).toThrow(
        BadRequestException,
      );
      expect(() => pipe.transform('not-an-array')).toThrow(
        BadRequestException,
      );
    });

    test('a valid list body parses through the route pipe unchanged', () => {
      const pipe = new ZodValidationPipe(listReplaceSchema);

      expect(pipe.transform(['a@example.com', 'b@example.com'])).toEqual([
        'a@example.com',
        'b@example.com',
      ]);
    });
  });
});
