import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import {
  getAdminToken,
  getMailboxId,
  getMailboxToken,
} from '../core/auth-storage';

export const adminGuard: CanActivateFn = () => {
  const router = inject(Router);
  if (!getAdminToken()) {
    return router.createUrlTree(['/login']);
  }
  return true;
};

export const mailboxGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const id = route.paramMap.get('id');
  const token = getMailboxToken();
  const sessionId = getMailboxId();
  if (!getAdminToken()) {
    return router.createUrlTree(['/login']);
  }
  if (!token || !sessionId || sessionId !== id) {
    return router.createUrlTree(['/admin']);
  }
  return true;
};
