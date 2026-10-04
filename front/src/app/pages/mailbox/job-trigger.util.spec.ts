import { describe, expect, it } from 'vitest';
import { isJobTriggerDisabled } from './job-trigger.util';

describe('isJobTriggerDisabled', () => {
  it('is false for an idle job', () => {
    expect(isJobTriggerDisabled('scan', { scan: { status: 'idle' } })).toBe(false);
  });

  it('is true for a running job', () => {
    expect(isJobTriggerDisabled('scan', { scan: { status: 'running' } })).toBe(true);
  });

  it('is false for a different job while one job is running', () => {
    expect(isJobTriggerDisabled('train-ham', { scan: { status: 'running' } })).toBe(false);
  });

  it('is always false for init-folders, which has no tracked status', () => {
    expect(
      isJobTriggerDisabled('init-folders', {
        scan: { status: 'running' },
        trainSpam: { status: 'running' },
      }),
    ).toBe(false);
  });

  it('is false when no jobs status is available yet', () => {
    expect(isJobTriggerDisabled('scan', undefined)).toBe(false);
  });
});
