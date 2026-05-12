import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ToastService } from '../../../core/services/toast.service';
import { UserService } from '../../../core/services/user.service';
import type { User } from '../../../data/models';
import { API_BASE_URL } from '../../../core/config/api.config';

interface Permission {
  id: string;
  slug: string;
  description: string;
}

interface RoleWithPermissions {
  id: string;
  name: string;
  description: string;
  permissions: Permission[];
}

interface AuditLog {
  action: string;
  resource: string;
  createdAt: string;
}

@Component({
  selector: 'app-user-detail-panel',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .udp-overlay {
      position:fixed; inset:0; z-index:50; overflow:hidden;
    }
    .udp-backdrop {
      position:absolute; inset:0; background:rgba(0,0,0,0.65);
    }
    .udp-panel {
      position:absolute; right:0; top:0; height:100%;
      width:100%; max-width:500px;
      background:#0d1117;
      border-left:1px solid rgba(176,255,68,0.15);
      display:flex; flex-direction:column; overflow:hidden;
    }
    .udp-header {
      display:flex; align-items:center; justify-content:space-between;
      padding:1.25rem 1.5rem;
      border-bottom:1px solid rgba(176,255,68,0.1);
      flex-shrink:0;
    }
    .udp-title { font-size:1rem; font-weight:700; color:#fff; margin:0; }
    .udp-close {
      background:none; border:none; color:#8a9ab0;
      cursor:pointer; font-size:1.1rem; padding:4px 8px;
    }
    .udp-body {
      flex:1; overflow-y:auto; padding:1.5rem;
      display:flex; flex-direction:column; gap:1.5rem;
    }
    .udp-avatar-row {
      display:flex; align-items:center; gap:1rem;
      padding-bottom:1.25rem; border-bottom:1px solid #21262d;
    }
    .udp-avatar {
      width:56px; height:56px; border-radius:50%; flex-shrink:0;
      background:rgba(176,255,68,0.15);
      border:1px solid rgba(176,255,68,0.3);
      display:flex; align-items:center; justify-content:center;
      font-size:1.3rem; font-weight:700; color:#b0ff44;
    }
    .udp-name { font-size:1rem; font-weight:700; color:#e6edf3; margin:0 0 0.2rem; }
    .udp-email { font-size:0.78rem; color:#8a9ab0; margin:0; }
    .udp-section-title {
      font-size:0.65rem; font-weight:700; color:#484f58;
      letter-spacing:0.12em; margin-bottom:0.75rem; text-transform:uppercase;
    }
    .udp-info-grid {
      display:grid; grid-template-columns:1fr 1fr; gap:0.75rem;
    }
    .udp-info-item label {
      display:block; font-size:0.65rem; color:#8a9ab0;
      font-weight:600; margin-bottom:0.25rem; letter-spacing:0.05em;
    }
    .udp-info-item p {
      font-size:0.8rem; color:#e6edf3; margin:0;
      background:#161b22; border:1px solid #21262d;
      border-radius:5px; padding:6px 10px;
    }
    .udp-badge-active {
      display:inline-block;
      background:rgba(46,160,67,0.12); border:1px solid rgba(46,160,67,0.3);
      color:#2ea043; border-radius:20px; padding:3px 12px;
      font-size:0.7rem; font-weight:600;
    }
    .udp-badge-inactive {
      display:inline-block;
      background:rgba(255,68,68,0.1); border:1px solid rgba(255,68,68,0.3);
      color:#ff4444; border-radius:20px; padding:3px 12px;
      font-size:0.7rem; font-weight:600;
    }
    .udp-badge-pending {
      display:inline-block;
      background:rgba(255,170,0,0.12); border:1px solid rgba(255,170,0,0.3);
      color:#ffaa00; border-radius:20px; padding:3px 12px;
      font-size:0.7rem; font-weight:600;
    }
    .udp-role-select {
      width:100%; background:#161b22;
      border:1px solid rgba(176,255,68,0.2);
      border-radius:6px; color:#e6edf3;
      font-size:0.82rem; padding:8px 12px;
      outline:none; cursor:pointer;
    }
    .udp-save-btn {
      margin-top:0.5rem; padding:8px 20px;
      background:#b0ff44; color:#07090b;
      border:none; border-radius:6px;
      font-size:0.8rem; font-weight:700;
      cursor:pointer; transition:opacity 0.2s;
    }
    .udp-save-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .udp-perm-grid {
      display:grid; grid-template-columns:1fr 1fr; gap:0.5rem;
    }
    .udp-perm-item {
      display:flex; align-items:flex-start; gap:0.5rem;
      padding:8px 10px;
      background:#161b22; border:1px solid #21262d;
      border-radius:6px;
    }
    .udp-perm-dot {
      width:7px; height:7px; border-radius:50%;
      background:#b0ff44; flex-shrink:0; margin-top:3px;
    }
    .udp-perm-slug {
      font-size:0.7rem; font-weight:600;
      color:#b0ff44; font-family:monospace; display:block;
    }
    .udp-perm-desc {
      font-size:0.62rem; color:#8a9ab0; display:block; margin-top:1px;
    }
    .udp-no-perm {
      font-size:0.78rem; color:#484f58; text-align:center; padding:1rem;
    }
    .udp-audit-item {
      display:flex; align-items:center; gap:0.75rem;
      padding:8px 12px;
      background:#161b22; border:1px solid #21262d;
      border-radius:6px;
    }
    .udp-audit-action {
      font-size:0.72rem; font-weight:600; color:#e6edf3;
      font-family:monospace;
    }
    .udp-audit-time {
      font-size:0.65rem; color:#484f58; margin-left:auto; white-space:nowrap;
    }
    .udp-divider { height:1px; background:#21262d; }
  `],
  template: `
    <div class="udp-overlay">
      <div class="udp-backdrop" (click)="closed.emit()"></div>
      <div class="udp-panel">

        <!-- Header -->
        <div class="udp-header">
          <h2 class="udp-title">User Details</h2>
          <button class="udp-close" (click)="closed.emit()">✕</button>
        </div>

        <!-- Body -->
        <div class="udp-body">

          <!-- Avatar + name -->
          <div class="udp-avatar-row">
            <div class="udp-avatar">
              {{ user().fullName?.charAt(0)?.toUpperCase() ?? 'U' }}
            </div>
            <div>
              <p class="udp-name">
                {{ user().fullName }}
                @if (user().verified) {
                  <span style="color:#2ea043; font-size:0.8rem;">✓</span>
                }
              </p>
              <p class="udp-email">{{ user().email }}</p>
            </div>
          </div>

          <!-- Info grid -->
          <div>
            <p class="udp-section-title">User Information</p>
            <div class="udp-info-grid">
              <div class="udp-info-item">
                <label>JOB TITLE</label>
                <p>{{ user().jobTitle || '—' }}</p>
              </div>
              <div class="udp-info-item">
                <label>DEPARTMENT</label>
                <p>{{ user().department || '—' }}</p>
              </div>
              <div class="udp-info-item">
                <label>STATUS</label>
                <p style="background:transparent; border:none; padding:0;">
                  @if (user().status === 'PENDING') {
                    <span class="udp-badge-pending">⏳ Pending</span>
                  } @else if (user().isActive) {
                    <span class="udp-badge-active">● Active</span>
                  } @else {
                    <span class="udp-badge-inactive">○ Inactive</span>
                  }
                </p>
              </div>
              <div class="udp-info-item">
                <label>MFA</label>
                <p>{{ user().mfaEnabled ? '✓ Enabled' : '✗ Disabled' }}</p>
              </div>
            </div>
          </div>

          <div class="udp-divider"></div>

          <!-- Role assignment -->
          <div>
            <p class="udp-section-title">Role & Access</p>
            <select class="udp-role-select"
              [value]="selectedRole()"
              (change)="selectedRole.set($any($event.target).value)">
              <option value="User">Standard User</option>
              <option value="Admin">Administrator</option>
            </select>
            <div style="display:flex; align-items:center; gap:0.75rem; margin-top:0.5rem;">
              <button class="udp-save-btn"
                [disabled]="selectedRole() === currentRole() || saving()"
                (click)="saveRole()">
                {{ saving() ? 'Saving…' : 'Save Role' }}
              </button>
              @if (selectedRole() !== currentRole()) {
                <span style="font-size:0.7rem; color:#ffaa00;">⚠ Unsaved change</span>
              }
            </div>
          </div>

          <div class="udp-divider"></div>

          <!-- Permissions -->
          <div>
            <p class="udp-section-title">
              Permissions
              <span style="color:#484f58; font-weight:400; text-transform:none;">
                — inherited from role
              </span>
            </p>
            @if (rolePermissions().length === 0) {
              <p class="udp-no-perm">No permissions for this role.</p>
            } @else {
              <div class="udp-perm-grid">
                @for (perm of rolePermissions(); track perm.id) {
                  <div class="udp-perm-item">
                    <span class="udp-perm-dot"></span>
                    <div>
                      <span class="udp-perm-slug">{{ perm.slug }}</span>
                      <span class="udp-perm-desc">{{ perm.description }}</span>
                    </div>
                  </div>
                }
              </div>
            }
          </div>

          <div class="udp-divider"></div>

          <!-- Recent audit -->
          <div>
            <p class="udp-section-title">Recent Activity</p>
            @if (auditLogs().length === 0) {
              <p class="udp-no-perm">No recent activity.</p>
            } @else {
              <div style="display:flex; flex-direction:column; gap:0.4rem;">
                @for (log of auditLogs(); track log.createdAt) {
                  <div class="udp-audit-item">
                    <span class="udp-audit-action">{{ log.action }}</span>
                    <span style="font-size:0.68rem; color:#8a9ab0;">{{ log.resource }}</span>
                    <span class="udp-audit-time">
                      {{ log.createdAt | date:'dd/MM HH:mm' }}
                    </span>
                  </div>
                }
              </div>
            }
          </div>

        </div>
      </div>
    </div>
  `,
})
export class UserDetailPanelComponent implements OnInit {
  private readonly http        = inject(HttpClient);
  private readonly userService = inject(UserService);
  private readonly toast       = inject(ToastService);

  user   = input.required<User>();
  closed = output<void>();
  saved  = output<User>();

  readonly selectedRole    = signal('User');
  readonly currentRole     = signal('User');
  readonly rolePermissions = signal<Permission[]>([]);
  readonly auditLogs       = signal<AuditLog[]>([]);
  readonly saving          = signal(false);

  private allRoles: RoleWithPermissions[] = [];

  ngOnInit(): void {
    const role = this.user().roles?.[0]?.name ?? 'User';
    this.selectedRole.set(role);
    this.currentRole.set(role);

    // Load roles with permissions
    this.http.get<RoleWithPermissions[]>(`${API_BASE_URL}/api/v1/roles`)
      .subscribe({
        next: (roles) => {
          this.allRoles = roles;
          this.updatePermissions(role);
        },
        error: () => {},
      });

    // Load recent audit logs for this user
    this.http.get<{ content: AuditLog[] }>(
      `${API_BASE_URL}/api/v1/audit-logs?userId=${this.user().id}&size=5`
    ).subscribe({
      next: (res) => this.auditLogs.set(res.content ?? []),
      error: () => {},
    });
  }

  saveRole(): void {
    const newRole = this.selectedRole();
    this.saving.set(true);
    this.userService.assignRole(this.user().id, newRole).subscribe({
      next: (updated) => {
        this.saving.set(false);
        this.currentRole.set(newRole);
        this.updatePermissions(newRole);
        this.toast.success(`Role updated to ${newRole}`);
        this.saved.emit(updated as unknown as User);
      },
      error: () => {
        this.saving.set(false);
        this.toast.error('Failed to update role');
      },
    });
  }

  private updatePermissions(roleName: string): void {
    const role = this.allRoles.find(r => r.name === roleName);
    this.rolePermissions.set(role?.permissions ?? []);
  }
}
