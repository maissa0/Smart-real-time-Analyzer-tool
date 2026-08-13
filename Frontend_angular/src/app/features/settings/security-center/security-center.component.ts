import { ChangeDetectionStrategy, Component, input, inject, OnInit } from '@angular/core';
import { MfaEnrollmentComponent } from './mfa-enrollment/mfa-enrollment.component';
import { ActiveSessionsComponent } from './active-sessions/active-sessions.component';
import { BreadcrumbComponent } from '../../../shared/components/breadcrumb/breadcrumb.component';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';

@Component({
  selector: 'app-security-center',
  standalone: true,
  imports: [MfaEnrollmentComponent, ActiveSessionsComponent, BreadcrumbComponent],
  template: `
    <div class="space-y-8">
      @if (!embedded()) {
        <div class="flex flex-col gap-2">
          <app-breadcrumb />
          <h1 class="text-2xl font-bold text-gray-900">Security Center</h1>
        </div>
      }
      <div class="sc-grid">
        <app-mfa-enrollment />
        <app-active-sessions />
      </div>
    </div>
  `,
  styles: [`
    .sc-grid {
      display: grid;
      gap: 14px;
      grid-template-columns: 1fr;
    }
    @media (min-width: 900px) {
      .sc-grid {
        grid-template-columns: 1fr 1fr;
      }
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SecurityCenterComponent implements OnInit {
  private readonly breadcrumb = inject(BreadcrumbService);
  readonly embedded = input(false);

  ngOnInit(): void {
    if (!this.embedded()) {
      this.breadcrumb.set([
        { label: 'Home', url: '/admin' },
        { label: 'Settings', url: '/admin/settings/security' },
        { label: 'Security Center' },
      ]);
    }
  }
}
