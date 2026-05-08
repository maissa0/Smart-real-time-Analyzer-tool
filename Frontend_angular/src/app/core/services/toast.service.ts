import { Injectable, signal, computed } from '@angular/core';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  details?: string[];
  duration?: number;
  createdAt: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private _idCounter = 0;

  show(message: string, type: ToastType = 'info', options?: { details?: string[]; duration?: number }): void {
    const id = `toast-${++this._idCounter}`;
    const toast: Toast = {
      id,
      message,
      type,
      details: options?.details,
      duration: options?.duration ?? 5000,
      createdAt: Date.now(),
    };
    this._toasts.update((t) => [...t, toast]);
    if (toast.duration && toast.duration > 0) {
      setTimeout(() => this.dismiss(id), toast.duration);
    }
  }

  success(message: string, details?: string[]): void {
    this.show(message, 'success', { details });
  }

  error(message: string, details?: string[]): void {
    this.show(message, 'error', { details, duration: 8000 });
  }

  warning(message: string, details?: string[]): void {
    this.show(message, 'warning', { details });
  }

  info(message: string, details?: string[]): void {
    this.show(message, 'info', { details });
  }

  dismiss(id: string): void {
    this._toasts.update((t) => t.filter((x) => x.id !== id));
  }

  clear(): void {
    this._toasts.set([]);
  }
}
