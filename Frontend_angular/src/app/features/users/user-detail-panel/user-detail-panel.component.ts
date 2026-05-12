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
      width:100%; max-width:720px;
      background:#0d1117;
      border-left:1px solid rgba(176,255,68,0.15);
      display:flex; flex-direction:column; overflow:hidden;
    }
    .udp-header {
      display:flex; align-items:center; justify-content:space-between;
      padding:1.25rem 2rem;
      border-bottom:1px solid rgba(176,255,68,0.1);
      flex-shrink:0;
    }
    .udp-title { font-size:1rem; font-weight:700; color:#fff; margin:0; }
    .udp-close {
      background:none; border:none; color:#8a9ab0;
      cursor:pointer; font-size:1.1rem; padding:4px 8px;
    }
    .udp-body {
      flex:1; overflow-y:auto; padding:2rem;
      display:flex; flex-direction:column; gap:1.75rem;
    }
    .udp-avatar-row {
      display:flex; align-items:center; gap:1.25rem;
      padding-bottom:1.5rem; border-bottom:1px solid #21262d;
    }
    .udp-avatar {
      width:64px; height:64px; border-radius:50%; flex-shrink:0;
      background:rgba(176,255,68,0.15);
      border:2px solid rgba(176,255,68,0.3);
      display:flex; align-items:center; justify-content:center;
      font-size:1.5rem; font-weight:700; color:#b0ff44;
    }
    .udp-name { font-size:1.1rem; font-weight:700; color:#e6edf3; margin:0 0 0.25rem; }
    .udp-email { font-size:0.82rem; color:#8a9ab0; margin:0; }
    .udp-section-title {
      font-size:0.65rem; font-weight:700; color:#484f58;
      letter-spacing:0.12em; margin-bottom:0.75rem; text-transform:uppercase;
    }
    .udp-info-grid {
      display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.75rem;
    }
    .udp-info-item label {
      display:block; font-size:0.65rem; color:#8a9ab0;
      font-weight:600; margin-bottom:0.25rem; letter-spacing:0.05em;
    }
    .udp-info-item p {
      font-size:0.82rem; color:#e6edf3; margin:0;
      background:#161b22; border:1px solid #21262d;
      border-radius:6px; padding:7px 12px;
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
    .udp-divider { height:1px; background:#21262d; }
    .udp-role-select {
      width:100%; background:#161b22;
      border:1px solid rgba(176,255,68,0.2);
      border-radius:6px; color:#e6edf3;
      font-size:0.85rem; padding:9px 12px;
      outline:none; cursor:pointer;
    }
    .udp-save-btn {
      padding:8px 22px;
      background:#b0ff44; color:#07090b;
      border:none; border-radius:6px;
      font-size:0.82rem; font-weight:700;
      cursor:pointer; transition:opacity 0.2s;
    }
    .udp-save-btn:disabled { opacity:0.4; cursor:not-allowed; }
    .udp-save-btn-outline {
      padding:8px 22px;
      background:transparent; color:#b0ff44;
      border:1px solid rgba(176,255,68,0.4);
      border-radius:6px;
      font-size:0.82rem; font-weight:700;
      cursor:pointer; transition:all 0.2s;
    }
    .udp-save-btn-outline:disabled { opacity:0.4; cursor:not-allowed; }

    /* Permissions grid */
    .udp-perm-grid {
      display:grid; grid-template-columns:1fr 1fr 1fr; gap:0.5rem;
    }
    .udp-perm-item {
      display:flex; align-items:flex-start; gap:0.5rem;
      padding:10px 12px;
      background:#161b22; border:1px solid #21262d;
      border-radius:6px; cursor:pointer; transition:all 0.15s;
      position:relative;
    }
    .udp-perm-item.role-perm {
      border-color:rgba(176,255,68,0.15);
    }
    .udp-perm-item.extra-perm {
      border-color:rgba(88,166,255,0.3);
      background:rgba(88,166,255,0.05);
    }
    .udp-perm-item.selectable:hover {
      border-color:rgba(176,255,68,0.4);
      background:rgba(176,255,68,0.05);
    }
    .udp-perm-item.selected {
      border-color:#b0ff44;
      background:rgba(176,255,68,0.08);
    }
    .udp-perm-dot {
      width:8px; height:8px; border-radius:50%;
      flex-shrink:0; margin-top:3px;
    }
    .udp-perm-dot.lime { background:#b0ff44; }
    .udp-perm-dot.blue { background:#58a6ff; }
    .udp-perm-dot.gray { background:#30363d; }
    .udp-perm-slug {
      font-size:0.7rem; font-weight:600;
      color:#b0ff44; font-family:monospace; display:block;
    }
    .udp-perm-desc {
      font-size:0.62rem; color:#8a9ab0; display:block; margin-top:1px;
    }
    .udp-perm-tag {
      position:absolute; top:4px; right:6px;
      font-size:0.55rem; font-weight:700; letter-spacing:0.05em;
      color:#484f58;
    }

    /* Audit */
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
                  <span style="color:#2ea043; font-size:0.85rem;">✓</span>
                }
              </p>
              <p class="udp-email">{{ user().email }}</p>
              <p style="font-size:0.72rem; color:#484f58; margin:0.2rem 0 0;">
                @if (user().createdAt) {
                  Member since {{ user().createdAt | date:'dd MMM yyyy' }}
                }
              </p>
            </div>
          </div>

          <!-- Info -->
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
                <label>MFA</label>
                <p>{{ user().mfaEnabled ? '✓ Enabled' : '✗ Disabled' }}</p>
              </div>
              <div class="udp-info-item" style="grid-column:span 2;">
                <label>STATUS</label>
                <p style="background:transparent; border:none; padding:0;">
                  @if (user().status === 'PENDING') {
                    <span class="udp-badge-pending">⏳ Pending approval</span>
                  } @else if (user().isActive) {
                    <span class="udp-badge-active">● Active</span>
                  } @else {
                    <span class="udp-badge-inactive">○ Inactive</span>
                  }
                </p>
              </div>
            </div>
          </div>

          <div class="udp-divider"></div>

          <!-- Role -->
          <div>
            <p class="udp-section-title">Role & Access</p>
            <div style="display:flex; align-items:center; gap:0.75rem;">
              <select class="udp-role-select" style="flex:1;"
                [value]="selectedRole()"
                (change)="selectedRole.set($any($event.target).value)">
                <option value="User">Standard User</option>
                <option value="Admin">Administrator</option>
              </select>
              <button class="udp-save-btn"
                [disabled]="selectedRole() === currentRole() || savingRole()"
                (click)="saveRole()">
                {{ savingRole() ? 'Saving…' : 'Save Role' }}
              </button>
            </div>
            @if (selectedRole() !== currentRole()) {
              <p style="font-size:0.72rem; color:#ffaa00; margin:0.4rem 0 0;">
                ⚠ Changing role will update inherited permissions
              </p>
            }
          </div>

          <div class="udp-divider"></div>

          <!-- Permissions -->
          <div>
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:0.75rem;">
              <p class="udp-section-title" style="margin-bottom:0;">
                Permissions
              </p>
              <div style="display:flex; gap:0.5rem; align-items:center;">
                <span style="font-size:0.65rem; color:#484f58;">
                  <span style="color:#b0ff44;">●</span> Role
                  &nbsp;<span style="color:#58a6ff;">●</span> Extra
                </span>
                <button class="udp-save-btn-outline"
                  [disabled]="!permissionsChanged() || savingPerms()"
                  (click)="savePermissions()">
                  {{ savingPerms() ? 'Saving…' : 'Save Permissions' }}
                </button>
              </div>
            </div>
            <p style="font-size:0.7rem; color:#484f58; margin:0 0 0.75rem;">
              Click to toggle extra permissions for this user.
              Role permissions are always inherited and cannot be removed here.
            </p>
            @if (allPermissions().length === 0) {
              <p style="color:#484f58; font-size:0.78rem; text-align:center; padding:1rem;">
                Loading permissions…
              </p>
            } @else {
              <div class="udp-perm-grid">
                @for (perm of allPermissions(); track perm.id) {
                  <div class="udp-perm-item"
                    [class.role-perm]="isRolePerm(perm.id) && !isExtraPerm(perm.id)"
                    [class.extra-perm]="isExtraPerm(perm.id)"
                    [class.selected]="isExtraPerm(perm.id)"
                    [class.selectable]="!isRolePerm(perm.id)"
                    (click)="toggleExtraPerm(perm)">
                    <span class="udp-perm-dot"
                      [class.lime]="isRolePerm(perm.id)"
                      [class.blue]="isExtraPerm(perm.id) && !isRolePerm(perm.id)"
                      [class.gray]="!isRolePerm(perm.id) && !isExtraPerm(perm.id)">
                    </span>
                    <div style="min-width:0;">
                      <span class="udp-perm-slug">{{ perm.slug }}</span>
                      <span class="udp-perm-desc">{{ perm.description }}</span>
                    </div>
                    @if (isRolePerm(perm.id)) {
                      <span class="udp-perm-tag">ROLE</span>
                    } @else if (isExtraPerm(perm.id)) {
                      <span class="udp-perm-tag" style="color:#58a6ff;">EXTRA</span>
                    }
                  </div>
                }
              </div>
            }
          </div>

          <div class="udp-divider"></div>

          <!-- Recent activity -->
          <div>
            <p class="udp-section-title">Recent Activity</p>
            @if (auditLogs().length === 0) {
              <p style="color:#484f58; font-size:0.78rem; text-align:center; padding:1rem;">
                No recent activity.
              </p>
            } @else {
              <div style="display:flex; flex-direction:column; gap:0.4rem;">
                @for (log of auditLogs(); track log.createdAt) {
                  <div class="udp-audit-item">
                    <span class="udp-audit-action">{{ log.action }}</span>
                    <span style="font-size:0.68rem; color:#8a9ab0;">
                      {{ log.resource }}
                    </span>
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
  readonly allPermissions  = signal<Permission[]>([]);
  readonly rolePermIds     = signal<Set<string>>(new Set());
  readonly extraPermIds    = signal<Set<string>>(new Set());
  readonly originalExtraIds = signal<Set<string>>(new Set());
  readonly auditLogs       = signal<AuditLog[]>([]);
  readonly savingRole      = signal(false);
  readonly savingPerms     = signal(false);

  private allRoles: RoleWithPermissions[] = [];

  ngOnInit(): void {
    const role = this.user().roles?.[0]?.name ?? 'User';
    this.selectedRole.set(role);
    this.currentRole.set(role);

    // Load roles
    this.http.get<RoleWithPermissions[]>(`${API_BASE_URL}/api/v1/roles`)
      .subscribe({
        next: (roles) => {
          this.allRoles = roles;
          this.updateRolePerms(role);
        },
        error: () => {},
      });

    // Load user permissions
    this.userService.getUserPermissions(this.user().id).subscribe({
      next: (res) => {
        this.allPermissions.set(res.allPermissions ?? []);
        const roleIds = new Set<string>(
          (res.rolePermissions ?? []).map((p: Permission) => p.id)
        );
        const extraIds = new Set<string>(
          (res.extraPermissions ?? []).map((p: Permission) => p.id)
        );
        this.rolePermIds.set(roleIds);
        this.extraPermIds.set(extraIds);
        this.originalExtraIds.set(new Set(extraIds));
      },
      error: () => {},
    });

    // Load audit logs
    this.http.get<{ content: AuditLog[] }>(
      `${API_BASE_URL}/api/v1/audit-logs?userId=${this.user().id}&size=5`
    ).subscribe({
      next: (res) => this.auditLogs.set(res.content ?? []),
      error: () => {},
    });
  }

  isRolePerm(id: string): boolean {
    return this.rolePermIds().has(id);
  }

  isExtraPerm(id: string): boolean {
    return this.extraPermIds().has(id);
  }

  permissionsChanged(): boolean {
    const current = this.extraPermIds();
    const original = this.originalExtraIds();
    if (current.size !== original.size) return true;
    for (const id of current) {
      if (!original.has(id)) return true;
    }
    return false;
  }

  toggleExtraPerm(perm: Permission): void {
    // Cannot toggle role permissions
    if (this.isRolePerm(perm.id)) return;
    const current = new Set(this.extraPermIds());
    if (current.has(perm.id)) {
      current.delete(perm.id);
    } else {
      current.add(perm.id);
    }
    this.extraPermIds.set(current);
  }

  saveRole(): void {
    const newRole = this.selectedRole();
    this.savingRole.set(true);
    this.userService.assignRole(this.user().id, newRole).subscribe({
      next: (updated) => {
        this.savingRole.set(false);
        this.currentRole.set(newRole);
        this.updateRolePerms(newRole);
        this.toast.success(`Role updated to ${newRole}`);
        this.saved.emit(updated as unknown as User);
      },
      error: () => {
        this.savingRole.set(false);
        this.toast.error('Failed to update role');
      },
    });
  }

  savePermissions(): void {
    this.savingPerms.set(true);
    const permIds = [...this.extraPermIds()];
    this.userService.updateUserPermissions(this.user().id, permIds).subscribe({
      next: () => {
        this.savingPerms.set(false);
        this.originalExtraIds.set(new Set(this.extraPermIds()));
        this.toast.success('Permissions updated');
      },
      error: () => {
        this.savingPerms.set(false);
        this.toast.error('Failed to update permissions');
      },
    });
  }

  private updateRolePerms(roleName: string): void {
    const role = this.allRoles.find(r => r.name === roleName);
    const ids = new Set<string>((role?.permissions ?? []).map(p => p.id));
    this.rolePermIds.set(ids);
  }
}
