import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthStore } from '../../../core/store/auth.store';
import { SidebarStateService } from '../../../core/services/sidebar-state.service';
import { NlPaletteComponent } from '../../components/nl-ask/nl-palette.component';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [RouterLink, NlPaletteComponent],
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

  /** Ctrl+K itself is handled inside NlPaletteComponent; this backs the
   *  navbar search box, which now opens the ask-your-data palette. */
  private readonly palette = viewChild(NlPaletteComponent);

  openAsk(): void {
    this.palette()?.open.set(true);
  }
}
