import { Injectable, signal } from '@angular/core';

/** A finding's time window + involved bus signals, in absolute Unix seconds. */
export interface FindingFocus {
  start: number;
  end: number;
  /** Bus signal names involved in the finding (from the rule, may be empty). */
  signals: string[];
  /** Short label shown in the zoom banner (rule id or fault type). */
  label: string;
  /** Session the finding belongs to — consumers ignore the focus elsewhere. */
  sessionId?: string;
}

/**
 * Cross-view correlation channel (plan §3.2): clicking a finding publishes its
 * window here; the session inspector switches to the Charts tab and the
 * sniffer zooms its charts to the window and selects the involved signals.
 */
@Injectable({ providedIn: 'root' })
export class FindingFocusService {
  readonly focus = signal<FindingFocus | null>(null);

  set(focus: FindingFocus): void {
    this.focus.set(focus);
  }

  clear(): void {
    this.focus.set(null);
  }
}
