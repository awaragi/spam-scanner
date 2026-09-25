import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service.js';

/**
 * The one unguarded route the `server/mailbox-api` spec's liveness
 * requirement describes (design.md D8): `GET /health/live` reports only
 * that the process is up. Full health (`health()`) is served admin-scoped
 * by `AdminController` (`GET /admin/health`, task 9.1) - this controller
 * deliberately carries no other route.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  liveness(): { status: 'up' } {
    return this.healthService.liveness();
  }
}
