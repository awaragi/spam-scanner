import { Module } from '@nestjs/common';
import { AiGateway } from './ai.gateway.js';
import { AiFailureTracker } from '../../domain/ai/ai-failure-tracker.js';

/**
 * Provides `AiGateway` (the OpenAI-compatible classification client) and the
 * shared `AiFailureTracker` singleton (design.md D4): the AI provider is
 * shared across every mailbox, so classification failures are tracked
 * process-wide, not per mailbox session.
 *
 * `AiFailureTracker` itself stays a plain, undecorated domain class (domain/
 * is pure - see D1); registering it as a provider here is what turns it into
 * the one shared instance every consumer
 * (`application/scanning/ai-classification.step.ts`) injects. `AiGateway`'s
 * `AiConfig` dependency comes from the global `AppConfigModule`
 * (`config/config.module.ts`) without an explicit import here.
 */
@Module({
  providers: [AiGateway, AiFailureTracker],
  exports: [AiGateway, AiFailureTracker],
})
export class AiModule {}
