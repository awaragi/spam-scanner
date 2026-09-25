import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfigSchema } from './app-config.schema.js';
import {
  AiConfig,
  ApiAuthConfig,
  MailboxConnectionConfig,
  RspamdConfig,
  ScanConfig,
  ServerConfig,
  LoggingConfig,
  type AppConfigService,
} from './app-config.js';

const sections = [
  RspamdConfig,
  AiConfig,
  ScanConfig,
  LoggingConfig,
  ServerConfig,
  ApiAuthConfig,
  MailboxConnectionConfig,
];

/**
 * Validates the whole environment exactly once, at Nest bootstrap, through
 * `@nestjs/config`'s native Standard Schema support (`AppConfigSchema` is a
 * zod object, which implements the Standard Schema spec) - see design.md D5
 * and the `server/configuration` spec. `ConfigModule.forRoot` throws
 * (collecting every failing field into one error, since zod's `safeParse`
 * doesn't abort on the first issue) rather than letting the app start with
 * invalid configuration.
 *
 * `@Global()` so every other module can inject a typed section
 * (`RspamdConfig`, `AiConfig`, ...) without importing this module directly -
 * mirroring how `config.ts` is imported ambiently in `terminal/`.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // The server reads only process.env, like `terminal/`'s `config.ts` -
      // no implicit `.env` file loading, so behavior doesn't depend on
      // whichever directory the process happens to start in.
      ignoreEnvFile: true,
      validationSchema: AppConfigSchema,
    }),
  ],
  providers: sections.map(Section => ({
    provide: Section,
    useFactory: (config: AppConfigService) => new Section(config),
    inject: [ConfigService],
  })),
  exports: sections,
})
export class AppConfigModule {}
