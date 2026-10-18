export type StatusBadgeTone = 'neutral' | 'positive' | 'warning';

export interface StatusBadgeInput {
  enabled: boolean;
  state?: 'running' | 'degraded';
}

export interface StatusBadge {
  label: string;
  tone: StatusBadgeTone;
}

export function statusBadgeFor({ enabled, state }: StatusBadgeInput): StatusBadge {
  if (!enabled) {
    return { label: 'Disabled', tone: 'neutral' };
  }
  if (state === 'degraded') {
    return { label: 'Degraded', tone: 'warning' };
  }
  return { label: 'Running', tone: 'positive' };
}
