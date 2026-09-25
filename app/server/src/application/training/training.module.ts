import { Module } from '@nestjs/common';
import { RspamdModule } from '../../infrastructure/rspamd/rspamd.module.js';
import { RspamdTrainingService } from './rspamd-training.service.js';
import { SenderListTrainingService } from './sender-list-training.service.js';

/**
 * Provides `RspamdTrainingService` (trains rspamd from a mailbox's
 * `train.spam`/`train.ham` folders) and `SenderListTrainingService` (trains
 * the whitelist/blacklist from their folders), ported from terminal's
 * `train.controller.ts` and `sender-list-training.controller.ts`.
 * `ScanConfig` comes from the global `AppConfigModule`;
 * `RspamdTrainingService`'s `RspamdGateway` dependency comes from
 * `RspamdModule`.
 */
@Module({
  imports: [RspamdModule],
  providers: [RspamdTrainingService, SenderListTrainingService],
  exports: [RspamdTrainingService, SenderListTrainingService],
})
export class TrainingModule {}
