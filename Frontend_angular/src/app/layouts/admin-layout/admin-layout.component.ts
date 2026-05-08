import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarComponent } from '../../shared/layout/sidebar/sidebar.component';
import { NavbarComponent } from '../../shared/layout/navbar/navbar.component';

@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, NavbarComponent],
  template: `
    <div class="kpit-layout">
      <app-navbar />
      <app-sidebar />
      <main class="kpit-main-content p-6">
        <router-outlet />
      </main>
    </div>
  `,
  styleUrl: './admin-layout.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminLayoutComponent {}
