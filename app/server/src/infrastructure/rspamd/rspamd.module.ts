import { Module } from '@nestjs/common';
import { RspamdGateway } from './rspamd.gateway.js';

/**
 * Provides `RspamdGateway`, the injectable adapter for rspamd's HTTP API
 * (`checkEmail`/`learnHam`/`learnSpam`). `RspamdGateway`'s `RspamdConfig`
 * dependency comes from the global `AppConfigModule`
 * (`config/config.module.ts`) without an explicit import here - see that
 * module's doc comment.
 */
@Module({
  providers: [RspamdGateway],
  exports: [RspamdGateway],
})
export class RspamdModule {}
