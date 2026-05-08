import { Injectable, signal, computed } from '@angular/core';

export interface BreadcrumbItem {
  label: string;
  url?: string;
}

@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly _items = signal<BreadcrumbItem[]>([]);
  readonly items = this._items.asReadonly();

  set(items: BreadcrumbItem[]): void {
    this._items.set(items);
  }

  setFromPath(path: string, labels?: Record<string, string>): void {
    const segments = path.split('/').filter(Boolean);
    const items: BreadcrumbItem[] = [{ label: 'Home', url: '/admin' }];
    let currentPath = '';
    for (const seg of segments) {
      currentPath += `/${seg}`;
      const label = labels?.[seg] ?? this.formatLabel(seg);
      items.push({ label, url: currentPath });
    }
    this._items.set(items);
  }

  clear(): void {
    this._items.set([]);
  }

  private formatLabel(seg: string): string {
    return seg
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' ');
  }
}
