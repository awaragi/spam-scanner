import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { clearAdminToken, clearMailboxSession, getMailboxId } from '../core/auth-storage';
import { navRoleForPath } from './nav-role.util';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, MatToolbarModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-toolbar class="shell-toolbar">
      @switch (role()) {
        @case ('admin') {
          <span>Spam Scanner Admin</span>
          <span class="spacer"></span>
          <button type="button" mat-button (click)="logout()">Logout</button>
        }
        @case ('mailbox') {
          <button type="button" mat-button (click)="backToAdmin()">Back to admin</button>
          <span class="mailbox-id">Mailbox: {{ mailboxId() }}</span>
          <span class="spacer"></span>
          <button type="button" mat-button (click)="logout()">Logout</button>
        }
        @default {
          <span>Spam Scanner</span>
        }
      }
    </mat-toolbar>
    <main>
      <router-outlet />
    </main>
  `,
  styles: [
    `
      /* mat-toolbar's \`color\` input has no effect under M3 themes (see
         @angular/material's toolbar.d.ts) - themed directly via
         --mat-sys-* system variables instead. */
      .shell-toolbar {
        background-color: var(--mat-sys-primary);
        color: var(--mat-sys-on-primary);
        flex-wrap: wrap;
        height: auto;
        min-height: 64px;
        row-gap: 0.25rem;
      }
      .spacer {
        flex: 1 1 auto;
      }
      .mailbox-id {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 60vw;
      }
      main {
        display: block;
        padding: 1.5rem;
        max-width: 64rem;
        margin: 0 auto;
      }
      @media (max-width: 599px) {
        main {
          padding: 1rem;
        }
      }
    `,
  ],
})
export class AppShellComponent {
  private readonly router = inject(Router);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((event): event is NavigationEnd => event instanceof NavigationEnd),
      map((event) => event.urlAfterRedirects),
      startWith(this.router.url),
    ),
    { initialValue: this.router.url },
  );

  readonly role = computed(() => navRoleForPath(this.url()));
  readonly mailboxId = computed(() => getMailboxId() ?? '');

  logout(): void {
    clearAdminToken();
    clearMailboxSession();
    void this.router.navigate(['/login']);
  }

  backToAdmin(): void {
    clearMailboxSession();
    void this.router.navigate(['/admin']);
  }
}
