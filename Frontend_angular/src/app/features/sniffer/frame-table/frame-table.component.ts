import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CanFrame } from '../../../data/models/can.model';

export interface ParsedSignal {
  signal_name: string;
  raw_value: number;
  label: string;
}

/**
 * Pure presentational component — renders a CAN frame table.
 *
 * Accepts pre-filtered frames from SnifferComponent.
 * Does NOT own filtering, playback, or HTTP calls.
 * All logic stays in SnifferComponent — this component only renders.
 *
 * Design decision: pure @Input rendering avoids the complexity of
 * moving TelemetryService, playback, and signal-row logic into a
 * child component. The parent controls what frames are visible;
 * this component controls how they look.
 *
 * Inputs:
 *   frames       — pre-filtered frames to display
 *   sessionStartTs — session start timestamp for relative time column
 *   visibleSignalNames — Set<string> of signal names to show in sub-rows
 *
 * Outputs:
 *   frameClicked — emits frame.id when user clicks a row
 */
@Component({
  selector: 'app-frame-table',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    :host { display: block; width: 100%; }

    .ft-wrap {
      width: 100%;
      overflow-x: auto;
    }

    .ft-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.72rem;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }

    .ft-table thead th {
      background: #161b22;
      color: #8a9ab0;
      font-weight: 600;
      font-size: 0.65rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid #21262d;
      position: sticky;
      top: 0;
      z-index: 1;
    }

    .ft-table tbody .ft-row {
      border-bottom: 1px solid #161b22;
      cursor: pointer;
      transition: background 0.1s;
    }
    .ft-table tbody .ft-row:hover { background: #161b22; }

    .ft-table td {
      padding: 4px 8px;
      color: #e6edf3;
      white-space: nowrap;
    }

    .ft-num  { color: #484f58; width: 40px; }
    .ft-ts   { color: #8a9ab0; }
    .ft-ts-offset { font-size: 0.6rem; color: #484f58; }
    .ft-ch   { color: #8a9ab0; }
    .ft-id   { }
    .ft-addr-badge {
      display: inline-block;
      background: rgba(176,255,68,0.10);
      color: #b0ff44;
      border: 1px solid rgba(176,255,68,0.2);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 0.68rem;
    }
    .ft-msg  { color: #c9d1d9; }
    .ft-dir  { }
    .ft-dir-badge {
      display: inline-block;
      padding: 1px 6px;
      border-radius: 3px;
      font-size: 0.65rem;
      font-weight: 600;
      background: rgba(139,148,158,0.15);
      color: #8b949e;
    }
    .ft-dir-badge.tx {
      background: rgba(176,255,68,0.12);
      color: #b0ff44;
    }
    .ft-raw  { color: #484f58; font-size: 0.65rem; }

    .ft-signals-col { width: 80px; text-align: center; }
    .ft-signals-cell { text-align: center; white-space: nowrap; }

    .ft-expand-btn {
      background: transparent;
      border: 1px solid #30363d;
      border-radius: 4px;
      color: #8a9ab0;
      font-size: 0.65rem;
      padding: 1px 5px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .ft-expand-btn:hover, .ft-expand-btn.open {
      border-color: #b0ff44;
      color: #b0ff44;
    }

    .ft-fault-badge {
      display: inline-block;
      margin-left: 4px;
      color: #ffaa00;
      font-size: 0.75rem;
      cursor: help;
    }

    /* Signal sub-rows */
    .ft-sig-row { background: #0d1117; }
    .ft-sig-row td { padding: 2px 8px; }
    .ft-sig-name { color: #8a9ab0; font-size: 0.65rem; padding-left: 2rem !important; }
    .ft-sig-raw  { color: #484f58; font-size: 0.65rem; }
    .ft-sig-decoded { color: #b0ff44; font-size: 0.65rem; }

    /* Empty state */
    .ft-empty {
      text-align: center;
      color: #484f58;
      padding: 2.5rem;
      font-size: 0.78rem;
    }
  `],
  template: `
    <div class="ft-wrap">
      <table class="ft-table">
        <thead>
          <tr>
            <th class="ft-num">#</th>
            <th class="ft-ts">Timestamp</th>
            <th class="ft-ch">Ch</th>
            <th class="ft-id">ID</th>
            <th class="ft-msg">Message</th>
            <th class="ft-dir">Dir</th>
            <th class="ft-raw">Raw Bytes</th>
            <th class="ft-signals-col">Signals</th>
          </tr>
        </thead>
        <tbody>
          @if (frames().length === 0) {
            <tr>
              <td colspan="8" class="ft-empty">
                No frames to display
              </td>
            </tr>
          }
          @for (frame of frames(); track frame.id; let i = $index) {
            <tr class="ft-row" (click)="frameClicked.emit(frame.id)">
              <td class="ft-num">{{ i + 1 }}</td>
              <td class="ft-ts">
                <div>{{ frame.timestamp | number:'1.6-6' }}</div>
                <div class="ft-ts-offset">
                  +{{ (frame.timestamp - sessionStartTs()).toFixed(3) }}s
                </div>
              </td>
              <td class="ft-ch">{{ frame.channelName }}</td>
              <td class="ft-id">
                <span class="ft-addr-badge">{{ frame.msgId }}</span>
              </td>
              <td class="ft-msg">{{ frame.msgName }}</td>
              <td class="ft-dir">
                <span class="ft-dir-badge" [class.tx]="frame.direction === 'Tx'">
                  {{ frame.direction }}
                </span>
              </td>
              <td class="ft-raw">{{ frame.rawBytes }}</td>
              <!-- Signals expand button + fault badge -->
              <td class="ft-signals-cell">
                @if (parseSignals(frame).length > 0) {
                  <button type="button" class="ft-expand-btn"
                    [class.open]="expandedFrameId() === frame.id"
                    (click)="toggleExpand(frame.id); $event.stopPropagation()">
                    {{ expandedFrameId() === frame.id ? '▼' : '▶' }}
                  </button>
                }
                @if (faultsByFrameId().has(frame.id)) {
                  <span class="ft-fault-badge"
                    [title]="faultsByFrameId().get(frame.id)">
                    ⚠
                  </span>
                }
              </td>
            </tr>
            <!-- Expanded signal rows — shown when row is expanded -->
            @if (expandedFrameId() === frame.id) {
              @for (sig of parseSignals(frame); track sig.signal_name) {
                <tr class="ft-sig-row">
                  <td></td>
                  <td class="ft-sig-name" colspan="2">{{ sig.signal_name }}</td>
                  <td class="ft-sig-raw">{{ sig.raw_value }}</td>
                  <td class="ft-sig-decoded" colspan="4">{{ sig.label }}</td>
                </tr>
              }
            }
          }
        </tbody>
      </table>
    </div>
  `,
})
export class FrameTableComponent {

  /** Pre-filtered frames from SnifferComponent — pure rendering only. */
  readonly frames = input<CanFrame[]>([]);

  /** Session start timestamp — used for relative time column. */
  readonly sessionStartTs = input<number>(0);

  /**
   * Signal names to show in sub-rows.
   * Passed from SnifferComponent.visibleSignalNames signal.
   */
  readonly visibleSignalNames = input<Set<string>>(new Set());

  /** Map of frameId → faultType for ⚠ badge display. */
  readonly faultsByFrameId = input<Map<number, string>>(new Map());

  /** Currently expanded frame row (shows signal details inline). */
  readonly expandedFrameId = signal<number | null>(null);

  /** Emits frame.id when user clicks a row. */
  readonly frameClicked = output<number>();

  toggleExpand(frameId: number): void {
    this.expandedFrameId.set(
      this.expandedFrameId() === frameId ? null : frameId
    );
  }

  /** Parse signals JSON string into typed array. */
  parseSignals(frame: CanFrame): ParsedSignal[] {
    if (!frame.signals) return [];
    try {
      const parsed = JSON.parse(frame.signals);
      if (!Array.isArray(parsed)) return [];
      return parsed as ParsedSignal[];
    } catch {
      return [];
    }
  }
}
