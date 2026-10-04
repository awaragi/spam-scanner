import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { StatusBadgeInput, statusBadgeFor } from './status-badge.util';

/**
 * `MatChip`'s `color` input has no effect under M3 themes (see
 * `@angular/material`'s own chips.d.ts) - tone is styled directly via
 * `--mat-sys-*` system variables instead, picked per `tone` with a host
 * class.
 */
@Component({
  selector: 'app-status-badge',
  imports: [MatChipsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-chip-set>
      <mat-chip [class]="'status-badge status-badge--' + badge().tone" disableRipple highlighted>
        {{ badge().label }}
      </mat-chip>
    </mat-chip-set>
  `,
  styles: [
    `
      .status-badge--positive {
        --mdc-chip-elevated-container-color: var(--mat-sys-tertiary-container);
        --mdc-chip-label-text-color: var(--mat-sys-on-tertiary-container);
      }
      .status-badge--warning {
        --mdc-chip-elevated-container-color: var(--mat-sys-error-container);
        --mdc-chip-label-text-color: var(--mat-sys-on-error-container);
      }
      .status-badge--neutral {
        --mdc-chip-elevated-container-color: var(--mat-sys-surface-variant);
        --mdc-chip-label-text-color: var(--mat-sys-on-surface-variant);
      }
    `,
  ],
})
export class StatusBadgeComponent {
  readonly status = input.required<StatusBadgeInput>();
  readonly badge = computed(() => statusBadgeFor(this.status()));
}
