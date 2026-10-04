import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

const DURATION_MS = 4000;

@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: DURATION_MS,
      panelClass: 'notify-success',
    });
  }

  error(message: string): void {
    this.snackBar.open(message, 'Dismiss', {
      duration: DURATION_MS,
      panelClass: 'notify-error',
    });
  }
}
