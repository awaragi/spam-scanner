import { inject } from '@angular/core';
import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Router } from '@angular/router';
import { EMPTY, catchError, throwError } from 'rxjs';
import { clearAdminToken, clearMailboxSession } from './auth-storage';
import { isSessionExpiredResponse } from './session-expiry.util';
import { NotifyService } from '../shared/notify.service';

/**
 * Catches a 401 from any API call - not just the route guards' presence
 * check at navigation time - and forces a clean logout: an admin or
 * mailbox token can expire (or be invalidated) while the user is sitting on
 * a page with no navigation of their own, and without this every
 * subsequent call on that page just fails silently (an error toast, or
 * nothing at all depending on the call site), leaving the page showing
 * stale/empty data with no way back to `/login` short of knowing to log out
 * manually.
 *
 * The error is swallowed (`EMPTY`) rather than rethrown: the user is being
 * navigated away regardless, so letting the originating call site's own
 * error handler also fire would only show a second, redundant toast
 * alongside this one.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const router = inject(Router);
  const notify = inject(NotifyService);

  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse && isSessionExpiredResponse(req.url, err.status)) {
        clearAdminToken();
        clearMailboxSession();
        notify.error('Your session has expired. Please log in again.');
        void router.navigate(['/login']);
        return EMPTY;
      }
      return throwError(() => err);
    }),
  );
};
