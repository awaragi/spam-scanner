/** One UI section and the top-level settings keys it covers - a section's
 * "Override" checkbox is ON if any of its keys has a stored override, and
 * each key doubles as the top-level form control name (the settings form's
 * groups mirror the server's `overridableSchema` keys exactly), so no
 * separate mapping is needed between "form control" and "settings key". */
export interface SettingsSection {
  id: string;
  label: string;
  keys: readonly string[];
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'folders', label: 'Folders', keys: ['folders'] },
  { id: 'scanning', label: 'Scanning behavior', keys: ['scanRead', 'scanInitialState'] },
  { id: 'processingMode', label: 'Processing mode', keys: ['processingMode', 'labels'] },
  { id: 'thresholds', label: 'Thresholds', keys: ['thresholds'] },
  { id: 'aiEscalation', label: 'AI escalation', keys: ['aiEscalation'] },
];

/** Which sections have a real stored override, derived from the
 * `GET .../settings` response's `overriddenKeys`. */
export function sectionsWithOverride(overriddenKeys: readonly string[]): Set<string> {
  return new Set(
    SETTINGS_SECTIONS.filter((section) =>
      section.keys.some((key) => overriddenKeys.includes(key)),
    ).map((section) => section.id),
  );
}

/**
 * Builds the `PUT .../settings` request body: only the keys belonging to a
 * currently-overridden section, so an unchecked ("use default") section is
 * omitted entirely rather than pinned to its current value.
 *
 * Takes the form's raw value (`FormGroup.getRawValue()`, which includes
 * disabled controls) rather than `form.value` - **found via live testing**,
 * not assumption: disabling a nested `FormGroup` does NOT exclude it from
 * the parent's plain `.value` the way Angular's reactive-forms guide
 * describes for a disabled leaf `FormControl` - the whole point of this
 * function is to not depend on that framework behavior at all, filtering
 * explicitly instead.
 */
export function buildSettingsOverrideBody(
  rawValue: Record<string, unknown>,
  overridden: ReadonlySet<string>,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const section of SETTINGS_SECTIONS) {
    if (!overridden.has(section.id)) continue;
    for (const key of section.keys) {
      body[key] = rawValue[key];
    }
  }
  return body;
}
