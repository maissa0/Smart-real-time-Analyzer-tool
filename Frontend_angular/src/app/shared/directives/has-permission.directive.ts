import {
  Directive,
  TemplateRef,
  ViewContainerRef,
  inject,
  effect,
  input,
} from '@angular/core';
import { AuthStore } from '../../core/store/auth.store';

/**
 * Structural directive that conditionally renders an element based on
 * whether the current user holds a specific permission slug.
 *
 * Usage: <button *appHasPermission="'user:write'">Edit</button>
 *
 * The directive reacts to AuthStore signal changes (e.g. after login,
 * logout, or role update) and removes the element from the DOM — not
 * just hides it — when the permission is absent.
 *
 * hasView tracks whether an embedded view is currently in the container.
 * Without this guard, createEmbeddedView() would be called on every
 * signal emission while the permission is true, stacking duplicate nodes.
 */
@Directive({
  selector: '[appHasPermission]',
  standalone: true,
})
export class HasPermissionDirective {
  private readonly authStore = inject(AuthStore);
  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainer = inject(ViewContainerRef);

  readonly appHasPermission = input.required<string>();

  private hasView = false;

  constructor() {
    effect(() => {
      const permission = this.appHasPermission();
      const granted = this.authStore.hasPermission(permission);

      if (granted && !this.hasView) {
        this.viewContainer.createEmbeddedView(this.templateRef);
        this.hasView = true;
      } else if (!granted && this.hasView) {
        this.viewContainer.clear();
        this.hasView = false;
      }
    });
  }
}
