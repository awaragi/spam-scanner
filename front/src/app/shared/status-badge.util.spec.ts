import { describe, expect, it } from 'vitest';
import { statusBadgeFor } from './status-badge.util';

describe('statusBadgeFor', () => {
  it('reports disabled as neutral regardless of state', () => {
    expect(statusBadgeFor({ enabled: false })).toEqual({ label: 'Disabled', tone: 'neutral' });
    expect(statusBadgeFor({ enabled: false, state: 'degraded' })).toEqual({
      label: 'Disabled',
      tone: 'neutral',
    });
  });

  it('reports an enabled, running mailbox as positive', () => {
    expect(statusBadgeFor({ enabled: true, state: 'running' })).toEqual({
      label: 'Running',
      tone: 'positive',
    });
  });

  it('reports an enabled, degraded mailbox as a warning', () => {
    expect(statusBadgeFor({ enabled: true, state: 'degraded' })).toEqual({
      label: 'Degraded',
      tone: 'warning',
    });
  });
});
