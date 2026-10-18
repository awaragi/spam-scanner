import { Component } from '@angular/core';
import { AppShellComponent } from './shared/app-shell.component';

@Component({
  imports: [AppShellComponent],
  selector: 'app-root',
  template: `<app-shell />`,
})
export class App {}
