import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  HostListener,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../../store/auth.store';
import { SidebarStateService } from '../../../core/services/sidebar-state.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NavbarComponent {
  readonly authStore = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly sidebarState = inject(SidebarStateService);

  readonly showProfile = signal(false);

  readonly initials = () => {
    const name = this.authStore.user()?.fullName ?? '';
    return (
      name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) || 'U'
    );
  };

  toggleSidebar(): void {
    this.sidebarState.toggle();
  }

  toggleProfile(): void {
    this.showProfile.update((v) => !v);
  }

  closeProfile(): void {
    this.showProfile.set(false);
  }

  onLogout(): void {
    this.authStore.logout();
    this.closeProfile();
    this.router.navigateByUrl('/auth/login');
  }

  focusSearch(): void {
    const input = document.querySelector<HTMLInputElement>('[data-global-search]');
    input?.focus();
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'k') {
      event.preventDefault();
      this.focusSearch();
    }
  }
}
