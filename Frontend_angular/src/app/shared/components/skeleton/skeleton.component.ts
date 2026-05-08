import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-skeleton',
  standalone: true,
  template: `
    <div
      [class]="'animate-pulse rounded ' + (height() ?? 'h-4') + ' ' + (width() ?? 'w-full') + ' ' + (class() ?? '')"
      [style.background]="'linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%)'"
      [style.background-size]="'200% 100%'"
      [style.animation]="'shimmer 1.5s infinite'"
    ></div>
  `,
  styles: [
    `
      @keyframes shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SkeletonComponent {
  height = input<string>();
  width = input<string>();
  class = input<string>();
}
