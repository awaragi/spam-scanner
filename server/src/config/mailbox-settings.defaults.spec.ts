import { describe, test, expect } from 'vitest';
import {
  defaultMailboxSettings,
  resolveMailboxSettings,
} from './mailbox-settings.defaults.js';

describe('defaultMailboxSettings', () => {
  test('aiEscalation.toLowThreshold does not exceed toHighThreshold', () => {
    expect(
      defaultMailboxSettings.aiEscalation.toLowThreshold,
    ).toBeLessThanOrEqual(defaultMailboxSettings.aiEscalation.toHighThreshold);
  });
});

describe('resolveMailboxSettings', () => {
  test('undefined overrides resolves to exactly defaultMailboxSettings', () => {
    expect(resolveMailboxSettings(undefined)).toEqual(defaultMailboxSettings);
    expect(resolveMailboxSettings(undefined)).toBe(defaultMailboxSettings);
  });

  test('overriding one folder name leaves every other folder name at default', () => {
    const resolved = resolveMailboxSettings({
      folders: { spam: 'INBOX.custom-spam' },
    });

    expect(resolved.folders).toEqual({
      ...defaultMailboxSettings.folders,
      spam: 'INBOX.custom-spam',
    });
  });

  test('overriding one threshold leaves the other two thresholds at default', () => {
    const resolved = resolveMailboxSettings({
      thresholds: { clean: 40 },
    });

    expect(resolved.thresholds).toEqual({
      ...defaultMailboxSettings.thresholds,
      clean: 40,
    });
  });

  test('overriding aiEnabled alone leaves every other top-level scalar at default', () => {
    const resolved = resolveMailboxSettings({ aiEnabled: false });

    expect(resolved.aiEnabled).toBe(false);
    expect(resolved.scanRead).toBe(defaultMailboxSettings.scanRead);
    expect(resolved.scanInitialState).toBe(
      defaultMailboxSettings.scanInitialState,
    );
    expect(resolved.processingMode).toBe(defaultMailboxSettings.processingMode);
  });

  test('overrides for groups not mentioned fall back entirely to their own default group', () => {
    const resolved = resolveMailboxSettings({ aiEnabled: false });

    expect(resolved.folders).toEqual(defaultMailboxSettings.folders);
    expect(resolved.labels).toEqual(defaultMailboxSettings.labels);
    expect(resolved.thresholds).toEqual(defaultMailboxSettings.thresholds);
    expect(resolved.aiEscalation).toEqual(defaultMailboxSettings.aiEscalation);
  });
});
