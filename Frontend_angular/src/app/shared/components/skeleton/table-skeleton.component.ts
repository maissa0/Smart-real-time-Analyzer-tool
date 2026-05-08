import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-table-skeleton',
  standalone: true,
  template: `
    <div class="overflow-hidden rounded-lg border border-gray-200">
      <table class="min-w-full">
        <thead class="bg-gray-50">
          <tr>
            @for (i of columns(); track i) {
              <th class="px-4 py-3">
                <div class="h-4 w-24 animate-pulse rounded bg-gray-200"></div>
              </th>
            }
          </tr>
        </thead>
        <tbody class="divide-y divide-gray-200 bg-white">
          @for (row of rows(); track row) {
            <tr>
              @for (col of columns(); track col) {
                <td class="px-4 py-3">
                  <div class="h-4 w-full animate-pulse rounded bg-gray-100"></div>
                </td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TableSkeletonComponent {
  rowCount = input(5);
  columnCount = input(5);
  rows = computed(() => Array.from({ length: this.rowCount() }, (_, i) => i));
  columns = computed(() => Array.from({ length: this.columnCount() }, (_, i) => i));
}
