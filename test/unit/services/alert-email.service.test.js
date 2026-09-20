import { describe, test, expect } from 'vitest';
import { buildAiFailureAlertEmail } from '../../../src/lib/services/alert-email.service.js';

describe('buildAiFailureAlertEmail', () => {
  const alert = {
    reason: 'RateLimitError',
    count: 3,
    lastError: 'Too many requests',
    lastAt: '2026-09-17T00:00:00.000Z',
  };

  test('includes the alert details and addresses the mailbox owner', () => {
    const raw = buildAiFailureAlertEmail(alert, 'owner@example.com');

    expect(raw).toContain('To: owner@example.com');
    expect(raw).toContain('RateLimitError');
    expect(raw).toContain('Too many requests');
    expect(raw).toContain('Consecutive failures: 3');
  });

  test('includes a Message-ID under the fixed, unrelated domain', () => {
    const raw = buildAiFailureAlertEmail(alert, 'owner@example.com');
    expect(raw).toMatch(/^Message-ID: <.+@spam-scanner\.internal>$/m);
  });

  test('is deterministic when now/messageId are overridden', () => {
    const opts = {
      now: () => new Date('2026-01-01T00:00:00Z'),
      messageId: () => 'fixed-id',
    };
    const raw = buildAiFailureAlertEmail(alert, 'owner@example.com', opts);

    expect(raw).toContain('Message-ID: <fixed-id@spam-scanner.internal>');
    expect(raw).toContain(
      `Date: ${new Date('2026-01-01T00:00:00Z').toUTCString()}`
    );
  });
});
