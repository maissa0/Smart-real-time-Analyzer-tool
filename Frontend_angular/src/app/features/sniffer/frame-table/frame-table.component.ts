import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { CanFrame, hasEnumLabel } from '../../../core/models/can.model';

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
 */
@Component({
  selector: 'app-frame-table',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block w-full' },
  template: `
    <div class="w-full overflow-x-auto">
      <table class="w-full border-collapse font-mono text-[0.72rem]">
        <thead>
          <tr>
            <th class="sticky top-0 z-[1] bg-zinc-900 text-slate-400 font-semibold text-[0.65rem] tracking-[0.08em] uppercase px-2 py-1.5 text-left border-b border-zinc-800 w-10">#</th>
            <th class="sticky top-0 z-[1] bg-zinc-900 text-slate-400 font-semibold text-[0.65rem] tracking-[0.08em] uppercase px-2 py-1.5 text-left border-b border-zinc-800">Timestamp</th>
            <th class="sticky top-0 z-[1] bg-zinc-900 text-slate-400 font-semibold text-[0.65rem] tracking-[0.08em] uppercase px-2 py-1.5 text-left border-b border-zinc-800">Ch</th>
            <th class="sticky top-0 z-[1] bg-zinc-900 text-slate-400 font-semibold text-[0.65rem] tracking-[0.08em] uppercase px-2 py-1.5 text-left border-b border-zinc-800">ID</th>
            <th class="sticky top-0 z-[1] bg-zinc-900 text-slate-400 font-semibold text-[0.65rem] tracking-[0.08em] uppercase px-2 py-1.5 text-left border-b border-zinc-800">Message</th>
            <th class="sticky top-0 z-[1] bg-zinc-900 text-slate-400 font-semibold text-[0.65rem] tracking-[0.08em] uppercase px-2 py-1.5 text-left border-b border-zinc-800">Dir</th>
            <th class="sticky top-0 z-[1] bg-zinc-900 text-slate-400 font-semibold text-[0.65rem] tracking-[0.08em] uppercase px-2 py-1.5 text-left border-b border-zinc-800">Raw Bytes</th>
            <th class="sticky top-0 z-[1] bg-zinc-900 text-slate-400 font-semibold text-[0.65rem] tracking-[0.08em] uppercase px-2 py-1.5 text-center border-b border-zinc-800 w-20">Signals</th>
          </tr>
        </thead>
        <tbody>
          @if (frames().length === 0) {
            <tr>
              <td colspan="8" class="text-center text-zinc-500 p-10 text-[0.78rem]">
                No frames to display
              </td>
            </tr>
          }
          @for (frame of frames(); track i; let i = $index) {
            <tr class="border-b border-zinc-900 cursor-pointer transition-colors duration-100"
              [class.bg-zinc-900]="expandedFrameKeys().has(frameKey(frame))"
              [class.hover:bg-zinc-900]="!expandedFrameKeys().has(frameKey(frame))"
              [ngClass]="violationFor(frame) ? 'bg-red-500/5' : ''"
              (click)="toggleExpand(frameKey(frame))">
              <td class="px-2 py-1 text-zinc-500 whitespace-nowrap w-10">{{ i + 1 }}</td>
              <td class="px-2 py-1 whitespace-nowrap">
                <div class="text-slate-100">{{ frame.timestamp | number:'1.6-6' }}</div>
                <div class="text-[0.6rem] text-zinc-500">
                  +{{ (frame.timestamp - sessionStartTs()).toFixed(3) }}s
                </div>
              </td>
              <td class="px-2 py-1 text-slate-400 whitespace-nowrap">{{ frame.channelName }}</td>
              <td class="px-2 py-1 whitespace-nowrap">
                <span class="inline-block bg-lime-400/10 text-lime-400 border border-lime-400/20 rounded px-1.5 py-px text-[0.68rem]">
                  {{ frame.msgId }}
                </span>
              </td>
              <td class="px-2 py-1 text-slate-300 whitespace-nowrap">{{ frame.msgName }}</td>
              <td class="px-2 py-1 whitespace-nowrap">
                <span class="inline-block px-1.5 py-px rounded-sm text-[0.65rem] font-semibold"
                  [ngClass]="frame.direction === 'Tx'
                    ? 'bg-lime-400/10 text-lime-400'
                    : 'bg-slate-400/15 text-slate-400'">
                  {{ frame.direction }}
                </span>
              </td>
              <td class="px-2 py-1 text-zinc-500 text-[0.65rem] whitespace-nowrap">{{ frame.rawBytes }}</td>
              <td class="px-2 py-1 text-center whitespace-nowrap">
                @if (parseSignals(frame).length > 0) {
                  <button type="button"
                    class="bg-transparent border rounded text-[0.65rem] px-1.5 py-px cursor-pointer transition-colors duration-150 hover:border-lime-400 hover:text-lime-400"
                    [class.border-lime-400]="expandedFrameKeys().has(frameKey(frame))"
                    [class.text-lime-400]="expandedFrameKeys().has(frameKey(frame))"
                    [class.border-zinc-700]="!expandedFrameKeys().has(frameKey(frame))"
                    [class.text-slate-400]="!expandedFrameKeys().has(frameKey(frame))"
                    (click)="toggleExpand(frameKey(frame)); $event.stopPropagation()">
                    {{ expandedFrameKeys().has(frameKey(frame)) ? '▼' : '▶' }}
                  </button>
                }
                @if (faultsByFrameId().has(faultKey(frame))) {
                  <span class="ml-1 text-amber-400 text-[0.75rem] cursor-help"
                    [title]="faultsByFrameId().get(faultKey(frame))">
                    ⚠
                  </span>
                }
                @if (violationFor(frame); as violation) {
                  <span class="ml-1 text-red-400 text-[0.75rem] cursor-help"
                    [title]="'In violation window: ' + violation">
                    ⏱
                  </span>
                }
              </td>
            </tr>
            @if (expandedFrameKeys().has(frameKey(frame))) {
              <!-- Sub-row header: the value cell sits under the frame table's ID
                   column, so without its own header it reads as a message ID. -->
              <tr class="bg-gray-900">
                <td class="px-2 pt-1.5 pb-0.5"></td>
                <td class="px-2 pt-1.5 pb-0.5 pl-8 text-zinc-600 text-[0.6rem] font-semibold tracking-[0.08em] uppercase" colspan="2">Signal</td>
                <td class="px-2 pt-1.5 pb-0.5 text-zinc-600 text-[0.6rem] font-semibold tracking-[0.08em] uppercase">Value</td>
                <td class="px-2 pt-1.5 pb-0.5 text-zinc-600 text-[0.6rem] font-semibold tracking-[0.08em] uppercase" colspan="4">Label</td>
              </tr>
              @for (sig of parseSignals(frame); track sig.signal_name) {
                <tr class="bg-gray-900">
                  <td class="px-2 py-0.5"></td>
                  <td class="px-2 py-0.5 text-slate-400 text-[0.65rem] pl-8" colspan="2">{{ sig.signal_name }}</td>
                  <td class="px-2 py-0.5 text-zinc-500 text-[0.65rem]">{{ sig.raw_value }}</td>
                  <!-- Enum-less numeric signals have no name to translate to —
                       echo the value so the column never looks empty. -->
                  <td class="px-2 py-0.5 text-[0.65rem]" colspan="4"
                    [class.text-lime-400]="hasEnum(sig.label)"
                    [class.text-zinc-500]="!hasEnum(sig.label)">
                    {{ hasEnum(sig.label) ? sig.label : sig.raw_value }}
                  </td>
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

  readonly frames = input<CanFrame[]>([]);
  readonly sessionStartTs = input<number>(0);
  readonly visibleSignalNames = input<Set<string>>(new Set());
  readonly faultsByFrameId = input<Map<string, string>>(new Map());
  /** Requirement-violation windows (absolute Unix seconds) — rows inside get tinted. */
  readonly violationWindows = input<{ start: number; end: number; label: string }[]>([]);
  readonly expandedFrameKeys = signal<Set<string>>(new Set());
  readonly frameClicked = output<number>();

  frameKey(frame: CanFrame): string {
    return `${frame.timestamp}:${frame.msgId}:${frame.channelName}`;
  }

  /** Matches IntegrityFault correlation key — msgId + timestamp rounded to the nearest
   * whole second (frame.timestamp is Unix seconds, not milliseconds — Math.round() here
   * lands on the same second-precision bucket sniffer.component.ts's faultsByFrameId uses).
   * Frames have no persisted frameId (InfluxDB-only), so faults can't link by id. */
  faultKey(frame: CanFrame): string {
    return `${frame.msgId}|${Math.round(frame.timestamp)}`;
  }

  /** Label of the first requirement-violation window containing this frame, or null. */
  violationFor(frame: CanFrame): string | null {
    for (const w of this.violationWindows()) {
      if (frame.timestamp >= w.start && frame.timestamp <= w.end) return w.label;
    }
    return null;
  }

  toggleExpand(key: string): void {
    this.expandedFrameKeys.update(keys => {
      const next = new Set(keys);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  /** Real catalogue enum label vs the decoder's raw:<n>/N/A fallbacks. */
  hasEnum(label: string): boolean {
    return hasEnumLabel(label);
  }

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
