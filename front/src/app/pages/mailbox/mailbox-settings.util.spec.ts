import { describe, expect, it } from 'vitest';
import { buildSettingsOverrideBody, sectionsWithOverride } from './mailbox-settings.util';

describe('sectionsWithOverride', () => {
  it('maps overridden top-level keys to their owning section', () => {
    expect(sectionsWithOverride(['thresholds', 'aiEscalation'])).toEqual(
      new Set(['thresholds', 'aiEscalation']),
    );
  });

  it('marks a section overridden if any of its (possibly several) keys is present', () => {
    expect(sectionsWithOverride(['labels'])).toEqual(new Set(['processingMode']));
    expect(sectionsWithOverride(['scanInitialState'])).toEqual(new Set(['scanning']));
  });

  it('returns an empty set for no overrides', () => {
    expect(sectionsWithOverride([])).toEqual(new Set());
  });
});

describe('buildSettingsOverrideBody', () => {
  const rawValue = {
    folders: { inbox: 'INBOX' },
    scanRead: true,
    scanInitialState: 'all',
    processingMode: 'label',
    labels: { spamLow: 'Low' },
    thresholds: { clean: 10 },
    aiEscalation: { toLowThreshold: 40 },
  };

  it('includes only the keys belonging to overridden sections', () => {
    const body = buildSettingsOverrideBody(rawValue, new Set(['thresholds']));
    expect(body).toEqual({ thresholds: { clean: 10 } });
  });

  it('includes both keys for a multi-key section', () => {
    const body = buildSettingsOverrideBody(rawValue, new Set(['processingMode']));
    expect(body).toEqual({ processingMode: 'label', labels: { spamLow: 'Low' } });
  });

  it('returns an empty body when nothing is overridden - reverts everything to defaults', () => {
    expect(buildSettingsOverrideBody(rawValue, new Set())).toEqual({});
  });

  it('includes every key when every section is overridden', () => {
    const allSectionIds = ['folders', 'scanning', 'processingMode', 'thresholds', 'aiEscalation'];
    const body = buildSettingsOverrideBody(rawValue, new Set(allSectionIds));
    expect(body).toEqual(rawValue);
  });
});
