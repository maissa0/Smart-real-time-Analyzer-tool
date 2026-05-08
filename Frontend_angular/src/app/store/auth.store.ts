import { computed } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import type { User } from '../data/models';
import type { Permission } from '../data/models/permission.model';

export interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  permissions: string[];
}

const initialState: AuthState = {
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,
  permissions: [],
};

function getInitialState(): AuthState {
  if (typeof localStorage === 'undefined') return initialState;
  const token = localStorage.getItem('access_token');
  if (!token) return initialState;
  try {
    const stored = localStorage.getItem('auth_user');
    const user = stored ? (JSON.parse(stored) as User) : null;
    const perms = localStorage.getItem('auth_permissions');
    const permissions = perms ? (JSON.parse(perms) as string[]) : [];
    return {
      user,
      accessToken: token,
      refreshToken: localStorage.getItem('refresh_token'),
      isAuthenticated: true,
      permissions,
    };
  } catch {
    return initialState;
  }
}

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState(getInitialState()),
  withComputed(({ user, isAuthenticated, permissions }) => ({
    /** Flattened permission slugs from user's roles for RBAC checks */
    permissionSlugs: computed(() => permissions()),
    /** Current user or null */
    currentUser: computed(() => user()),
    /** Whether the user is logged in */
    loggedIn: computed(() => isAuthenticated()),
  })),
  withMethods((store) => ({
    /** Check if the current user has a specific permission by slug */
    hasPermission(permissionSlug: string): boolean {
      return store.permissions().includes(permissionSlug);
    },
    /** Set authenticated user and tokens (AuthResponse shape) */
    setAuth(payload: {
      user: User;
      accessToken: string;
      refreshToken?: string;
      permissions?: Permission[];
    }): void {
      const slugs = payload.permissions?.map((p) => p.slug) ?? [];
      if (payload.accessToken) {
        localStorage.setItem('access_token', payload.accessToken);
      }
      if (payload.refreshToken) {
        localStorage.setItem('refresh_token', payload.refreshToken);
      }
      localStorage.setItem('auth_user', JSON.stringify(payload.user));
      localStorage.setItem('auth_permissions', JSON.stringify(slugs));
      patchState(store, {
        user: payload.user,
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken ?? null,
        isAuthenticated: true,
        permissions: slugs,
      });
    },
    /** Update access token (e.g., after refresh) */
    setAccessToken(token: string): void {
      patchState(store, { accessToken: token });
    },
    /** Update current user (e.g., after profile update) */
    updateUser(user: User): void {
      localStorage.setItem('auth_user', JSON.stringify(user));
      patchState(store, { user });
    },
    /** Clear auth state and trigger logout flow */
    logout(): void {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('auth_user');
      localStorage.removeItem('auth_permissions');
      patchState(store, initialState);
    },
  }))
);
