import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import { setAdminToken } from '../../core/auth-storage';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  template: `
    <h1>Admin login</h1>
    <form (ngSubmit)="submit()">
      <label>
        Password
        <input type="password" [(ngModel)]="password" name="password" required />
      </label>
      <button type="submit">Login</button>
    </form>
    @if (error()) {
      <pre>{{ error() }}</pre>
    }
  `,
})
export class LoginComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  password = '';
  readonly error = signal('');

  submit(): void {
    this.error.set('');
    this.api.login(this.password).subscribe({
      next: ({ token }) => {
        setAdminToken(token);
        void this.router.navigate(['/admin']);
      },
      error: (err) => {
        this.error.set(JSON.stringify(err.error ?? err.message, null, 2));
      },
    });
  }
}
