import { Routes } from '@angular/router';
import { adminGuard, mailboxGuard } from './guards/auth.guards';
import { AdminComponent } from './pages/admin/admin.component';
import { CreateAccountComponent } from './pages/admin/create-account.component';
import { LoginComponent } from './pages/login/login.component';
import { MailboxSettingsPanelComponent } from './pages/mailbox/mailbox-settings-panel.component';
import { MailboxComponent } from './pages/mailbox/mailbox.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'admin' },
  { path: 'login', component: LoginComponent },
  { path: 'admin', component: AdminComponent, canActivate: [adminGuard] },
  { path: 'admin/accounts/new', component: CreateAccountComponent, canActivate: [adminGuard] },
  {
    path: 'mailbox/:id',
    component: MailboxComponent,
    canActivate: [mailboxGuard],
  },
  {
    path: 'mailbox/:id/settings',
    component: MailboxSettingsPanelComponent,
    canActivate: [mailboxGuard],
  },
];
