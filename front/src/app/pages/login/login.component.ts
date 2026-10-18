import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ApiService } from '../../core/api.service';
import { setAdminToken } from '../../core/auth-storage';
import { httpErrorMessage } from '../../shared/http-error.util';
import { NotifyService } from '../../shared/notify.service';

@Component({
  selector: 'app-login',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
  ],
  template: `
    <mat-card class="login-card">
      <mat-card-header>
        <mat-card-title>Admin login</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <form (ngSubmit)="submit()">
          <mat-form-field appearance="outline" class="password-field">
            <mat-label>Password</mat-label>
            <input
              matInput
              type="password"
              [(ngModel)]="password"
              name="password"
              required
              autocomplete="current-password"
            />
          </mat-form-field>
          <div class="actions">
            <button type="submit" mat-flat-button [disabled]="!password || submitting()">
              @if (submitting()) {
                <mat-progress-spinner diameter="20" mode="indeterminate" />
              } @else {
                Login
              }
            </button>
          </div>
        </form>
      </mat-card-content>
    </mat-card>
  `,
  styles: [
    `
      .login-card {
        max-width: 24rem;
        margin: 4rem auto 0;
      }
      .password-field {
        width: 100%;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
      }
    `,
  ],
})
export class LoginComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotifyService);

  password = '';
  readonly submitting = signal(false);

  submit(): void {
    this.submitting.set(true);
    this.api.login(this.password).subscribe({
      next: ({ token }) => {
        setAdminToken(token);
        void this.router.navigate(['/admin']);
      },
      error: (err) => {
        this.submitting.set(false);
        this.notify.error(httpErrorMessage(err, 'Login failed.'));
      },
    });
  }
}
