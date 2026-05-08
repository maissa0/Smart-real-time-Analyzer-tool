import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { DatePipe } from '@angular/common';
import { ToastService } from '../../../../core/services/toast.service';
import { ProfileService } from '../../../../core/services/profile.service';
import type { Session } from '../../../../data/models/audit-log.model';

@Component({
  selector: 'app-active-sessions',
  standalone: true,
  imports: [DatePipe],
  templateUrl: './active-sessions.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActiveSessionsComponent implements OnInit {
  private readonly toast = inject(ToastService);
  private readonly profileService = inject(ProfileService);

  readonly sessions = signal<Session[]>([]);
  readonly isLoading = signal(true);
  readonly revokingId = signal<string | null>(null);

  ngOnInit(): void {
    this.loadSessions();
  }

  loadSessions(): void {
    this.isLoading.set(true);
    this.profileService.getSessions().subscribe({
      next: (sessions) => {
        this.sessions.set(sessions);
        this.isLoading.set(false);
      },
      error: () => {
        this.isLoading.set(false);
      },
    });
  }

  revokeSession(session: Session): void {
    this.revokingId.set(session.id);
    this.profileService.revokeSession(session.id).subscribe({
      next: () => {
        this.sessions.update((s) => s.filter((x) => x.id !== session.id));
        this.revokingId.set(null);
        this.toast.success(`Session on ${session.device ?? 'device'} has been revoked.`);
      },
      error: () => {
        this.revokingId.set(null);
      },
    });
  }
}
