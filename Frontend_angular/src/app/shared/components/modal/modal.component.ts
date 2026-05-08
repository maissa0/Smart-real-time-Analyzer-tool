import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';

@Component({
  selector: 'app-modal',
  standalone: true,
  template: `
    @if (isOpen()) {
      <div
        class="fixed inset-0 z-50 flex items-center justify-center"
        (click)="onBackdropClick($event)"
      >
        <div
          class="fixed inset-0 bg-black/50 transition-opacity"
          aria-hidden="true"
        ></div>
        <div
          [class]="sizeClass()"
          class="relative z-10 mx-4 max-h-[90vh] overflow-y-auto rounded-lg bg-white shadow-xl"
          (click)="$event.stopPropagation()"
          role="dialog"
          [attr.aria-modal]="true"
          [attr.aria-labelledby]="'modal-title'"
        >
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <h2 id="modal-title" class="text-lg font-semibold text-gray-900">
              {{ title() }}
            </h2>
            <button
              type="button"
              (click)="close()"
              class="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <svg class="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clip-rule="evenodd"
                />
              </svg>
            </button>
          </div>
          <div class="px-6 py-4">
            <ng-content />
          </div>
        </div>
      </div>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModalComponent {
  isOpen = input.required<boolean>();
  title = input<string>('');
  size = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  closeOnBackdrop = input(true);

  closed = output<void>();

  sizeClass = () => {
    const s = this.size();
    const map = {
      sm: 'w-full max-w-md',
      md: 'w-full max-w-lg',
      lg: 'w-full max-w-2xl',
      xl: 'w-full max-w-4xl',
    };
    return map[s];
  };

  close(): void {
    this.closed.emit();
  }

  onBackdropClick(event: MouseEvent): void {
    if (this.closeOnBackdrop() && (event.target as HTMLElement).classList.contains('bg-black/50')) {
      this.close();
    }
  }
}
