import { Module } from '@nestjs/common';
import { RspamdModule } from '../../infrastructure/rspamd/rspamd.module.js';
import { AiModule } from '../../infrastructure/ai/ai.module.js';
import { ScanService } from './scan.service.js';
import { PendingMessagesStep } from './pending-messages.step.js';
import { RspamdCheckStep } from './rspamd-check.step.js';
import { AiClassificationStep } from './ai-classification.step.js';
import { DispositionStep } from './disposition.step.js';
import { SenderListLookupStep } from './sender-list-lookup.step.js';

/**
 * Provides `ScanService` (a full mailbox scan, ported from terminal's
 * `scan.controller.ts` - see design.md D1) and its steps. `ScanConfig`/
 * `AiConfig` come from the global `AppConfigModule`; `RspamdGateway` comes
 * from `RspamdModule` and `AiGateway`/`AiFailureTracker` from `AiModule`.
 * Only `ScanService` is exported - the steps are this feature's own
 * implementation detail, used only by `ScanService` itself.
 */
@Module({
  imports: [RspamdModule, AiModule],
  providers: [
    ScanService,
    PendingMessagesStep,
    RspamdCheckStep,
    AiClassificationStep,
    DispositionStep,
    SenderListLookupStep,
  ],
  exports: [ScanService],
})
export class ScanningModule {}
