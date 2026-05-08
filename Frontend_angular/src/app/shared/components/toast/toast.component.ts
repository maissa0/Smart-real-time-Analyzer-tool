import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService, type ToastType } from '../../../core/services/toast.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  template: `
    <div class="fixed bottom-4 right-4 z-[9999] flex flex-col gap-2">
      @for (toast of toastService.toasts(); track toast.id) {
        <div
          [class]="typeClasses(toast.type)"
          class="flex min-w-[320px] max-w-md flex-col rounded-lg border px-4 py-3 shadow-lg"
          role="alert"
        >
          <div class="flex items-start justify-between gap-2">
            <p class="font-medium">{{ toast.message }}</p>
            <button
              type="button"
              (click)="toastService.dismiss(toast.id)"
              class="shrink-0 rounded p-1 opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              <svg class="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>
          @if (toast.details && toast.details.length > 0) {
            <ul class="mt-2 list-inside list-disc text-sm opacity-90">
              @for (d of toast.details; track d) {
                <li>{{ d }}</li>
              }
            </ul>
          }
        </div>
      }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastComponent {
  readonly toastService = inject(ToastService);

  typeClasses(type: ToastType): string {
    const base = 'border-l-4';
    const map: Record<ToastType, string> = {
      success: `${base} border-green-500 bg-green-50 text-green-800`,
      error: `${base} border-red-500 bg-red-50 text-red-800`,
      warning: `${base} border-amber-500 bg-amber-50 text-amber-800`,
      info: `${base} border-blue-500 bg-blue-50 text-blue-800`,
    };
    return map[type];
  }
}
