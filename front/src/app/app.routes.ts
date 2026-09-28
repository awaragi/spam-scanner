import { Routes } from '@angular/router';
import { adminGuard, mailboxGuard } from './guards/auth.guards';
import { AdminComponent } from './pages/admin/admin.component';
import { LoginComponent } from './pages/login/login.component';
import { MailboxComponent } from './pages/mailbox/mailbox.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'admin' },
  { path: 'login', component: LoginComponent },
  { path: 'admin', component: AdminComponent, canActivate: [adminGuard] },
  {
    path: 'mailbox/:id',
    component: MailboxComponent,
    canActivate: [mailboxGuard],
  },
];
