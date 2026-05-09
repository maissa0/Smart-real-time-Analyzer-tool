import {
  ChangeDetectionStrategy,
  Component,
  input,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';

/**
 * Reusable KPI card for the dashboard.
 * When isLive=true the card border pulses with #b0ff44 (KPIT green).
 *
 * Usage:
 * <app-kpi-card label="Sessions" [value]="88" [isLive]="true" />
 */
@Component({
  selector: 'app-kpi-card',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .kpi-card {
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 1.25rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.06);
      transition: border-color 0.3s;
    }
    .kpi-card.live {
      border-color: #b0ff44;
      animation: kpi-pulse 2s ease-in-out infinite;
    }
    @keyframes kpi-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(176,255,68,0.0); }
      50%       { box-shadow: 0 0 0 4px rgba(176,255,68,0.25); }
    }
    .kpi-label {
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #6b7280;
    }
    .kpi-value {
      font-size: 2rem;
      font-weight: 700;
      color: #111827;
      margin-top: 0.4rem;
      line-height: 1;
    }
    .kpi-sub {
      font-size: 0.72rem;
      color: #9ca3af;
      margin-top: 0.35rem;
    }
    .kpi-live-dot {
      display: inline-block;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #b0ff44;
      margin-left: 4px;
      animation: dot-blink 1.2s ease-in-out infinite;
    }
    @keyframes dot-blink {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.2; }
    }
  `],
  template: `
    <div class="kpi-card" [class.live]="isLive()">
      <p class="kpi-label">{{ label() }}</p>
      <p class="kpi-value">
        @if (isNumber()) {
          {{ numericValue() | number }}
        } @else {
          {{ value() }}
        }
        @if (isLive()) {
          <span class="kpi-live-dot" title="Live data"></span>
        }
      </p>
      @if (sub()) {
        <p class="kpi-sub">{{ sub() }}</p>
      }
    </div>
  `,
})
export class KpiCardComponent {
  readonly label  = input.required<string>();
  readonly value  = input.required<string | number>();
  readonly sub    = input<string>('');
  readonly isLive = input<boolean>(false);

  isNumber(): boolean {
    return typeof this.value() === 'number';
  }

  numericValue(): number {
    return this.value() as number;
  }
}
