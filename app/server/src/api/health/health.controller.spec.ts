import { describe, test, expect, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { HealthService } from './health.service.js';

describe('HealthController', () => {
  test('liveness delegates to HealthService.liveness() and returns its result', () => {
    const healthService = {
      liveness: vi.fn().mockReturnValue({ status: 'up' }),
      health: vi.fn(),
    };
    const controller = new HealthController(
      healthService as unknown as HealthService,
    );

    const result = controller.liveness();

    expect(healthService.liveness).toHaveBeenCalledWith();
    expect(result).toEqual({ status: 'up' });
  });

  test('requires no token - calling the handler needs no request/auth context at all', () => {
    const healthService = {
      liveness: vi.fn().mockReturnValue({ status: 'up' }),
      health: vi.fn(),
    };
    const controller = new HealthController(
      healthService as unknown as HealthService,
    );

    // No Authorization header, no request object, nothing - the handler
    // signature itself takes no such argument, unlike every guarded route.
    expect(() => controller.liveness()).not.toThrow();
  });
});
