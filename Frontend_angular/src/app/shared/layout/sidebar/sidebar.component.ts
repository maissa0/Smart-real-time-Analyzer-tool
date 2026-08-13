import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthStore } from '../../../core/store/auth.store';
import { SidebarStateService } from '../../../core/services/sidebar-state.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  private readonly sidebarState = inject(SidebarStateService);
  readonly authStore = inject(AuthStore);

  readonly isAdmin = () =>
    this.authStore.user()?.roles?.some(
      r => r.name === 'Admin'
    ) ?? false;

  readonly isOpen = this.sidebarState.isOpen;

  close(): void {
    this.sidebarState.close();
  }
}
