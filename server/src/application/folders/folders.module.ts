import { Module } from '@nestjs/common';
import { FolderInitService } from './folder-init.service.js';

/**
 * Provides `FolderInitService`, which creates a mailbox's app folders on
 * first use. It has no
 * injected dependencies of its own beyond `mailbox.gateway.ts`'s plain
 * functions.
 */
@Module({
  providers: [FolderInitService],
  exports: [FolderInitService],
})
export class FoldersModule {}
