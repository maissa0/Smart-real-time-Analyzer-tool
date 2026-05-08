import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BreadcrumbService } from '../../../core/services/breadcrumb.service';

@Component({
  selector: 'app-breadcrumb',
  standalone: true,
  imports: [RouterLink],
  template: `
    <nav class="flex" aria-label="Breadcrumb">
      <ol class="flex items-center gap-2 text-sm">
        @for (item of breadcrumbService.items(); track $index; let last = $last) {
          <li class="flex items-center gap-2">
            @if (last) {
              <span class="font-medium text-gray-900">{{ item.label }}</span>
            } @else if (item.url) {
              <a [routerLink]="item.url" class="text-gray-500 hover:text-gray-700">
                {{ item.label }}
              </a>
              <svg class="h-4 w-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
              </svg>
            } @else {
              <span class="text-gray-500">{{ item.label }}</span>
            }
          </li>
        }
      </ol>
    </nav>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BreadcrumbComponent {
  readonly breadcrumbService = inject(BreadcrumbService);
}
