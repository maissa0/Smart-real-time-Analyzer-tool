import {
  ChangeDetectionStrategy, Component, inject, output
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReplayEngineService } from '../../../core/services/replay-engine.service';

@Component({
  selector: 'app-replay-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  styles: [`
    .replay-bar {
      display: flex; flex-direction: column;
      padding: 0.6rem 1rem;
      background: #0d1117;
      border-bottom: 1px solid rgba(176,255,68,0.08);
      gap: 0.4rem;
      flex-shrink: 0;
    }
    .row1 {
      display: flex; align-items: center;
      gap: 0.5rem; flex-wrap: wrap;
    }
    .btn {
      display: flex; align-items: center; gap: 0.3rem;
      padding: 4px 12px; border-radius: 6px;
      font-size: 0.72rem; font-weight: 600;
      cursor: pointer; border: 1px solid;
      transition: all 0.15s; background: transparent;
    }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-play {
      border-color: #b0ff44; color: #b0ff44;
      background: rgba(176,255,68,0.08);
    }
    .btn-play:hover:not(:disabled) { background: rgba(176,255,68,0.15); }
    .btn-stop { border-color: #ff4444; color: #ff4444; }
    .btn-stop:hover { background: rgba(255,68,68,0.08); }
    .btn-skip {
      border-color: #30363d; color: #8a9ab0; padding: 4px 8px;
    }
    .btn-skip:hover { border-color: #b0ff44; color: #b0ff44; }
    .btn-speed {
      border-color: #30363d; color: #8a9ab0;
      padding: 3px 8px; font-size: 0.68rem;
    }
    .btn-speed.active {
      border-color: #b0ff44; color: #b0ff44;
      background: rgba(176,255,68,0.08);
    }
    .time-display {
      font-size: 0.72rem; color: #8a9ab0;
      font-family: monospace; white-space: nowrap;
    }
    .time-current { color: #e6edf3; }
    .spacer { flex: 1; }
    .badge {
      font-size: 0.65rem; font-weight: 600;
      padding: 2px 8px; border-radius: 4px;
    }
    .badge-loading {
      color: #f0a500; background: rgba(240,165,0,0.1);
      border: 1px solid rgba(240,165,0,0.3);
    }
    .badge-playing {
      color: #b0ff44; background: rgba(176,255,68,0.1);
      border: 1px solid rgba(176,255,68,0.3);
    }
    .badge-paused {
      color: #8a9ab0; background: rgba(138,154,176,0.1);
      border: 1px solid rgba(138,154,176,0.3);
    }
    .row2 {
      display: flex; align-items: center; gap: 0.5rem;
    }
    .slider {
      flex: 1; accent-color: #b0ff44;
      cursor: pointer; height: 4px;
    }
    .pts-info { font-size: 0.62rem; color: #484f58; white-space: nowrap; }
  `],
  template: `
    <div class="replay-bar">
      <div class="row1">

        <!-- Skip back 5s -->
        <button class="btn btn-skip"
          [disabled]="replay.state() === 'idle' || replay.state() === 'loading'"
          (click)="replay.skip(-5)">
          ◀◀ 5s
        </button>

        <!-- Play / Pause / Resume / Loading -->
        @if (replay.state() === 'idle') {
          <button class="btn btn-play" (click)="playRequested.emit()">
            ▶ Play
          </button>
        }
        @if (replay.state() === 'loading') {
          <button class="btn btn-play" disabled>
            ⏳ Loading...
          </button>
        }
        @if (replay.state() === 'playing') {
          <button class="btn btn-play" (click)="replay.pause()">
            ⏸ Pause
          </button>
        }
        @if (replay.state() === 'paused') {
          <button class="btn btn-play" (click)="replay.resume()">
            ▶ Resume
          </button>
        }

        <!-- Skip forward 5s -->
        <button class="btn btn-skip"
          [disabled]="replay.state() === 'idle' || replay.state() === 'loading'"
          (click)="replay.skip(5)">
          5s ▶▶
        </button>

        <!-- Stop -->
        @if (replay.state() !== 'idle') {
          <button class="btn btn-stop" (click)="stopRequested.emit()">
            ■ Stop
          </button>
        }

        <!-- Time -->
        <span class="time-display">
          <span class="time-current">{{ replay.currentTime().toFixed(2) }}s</span>
          / {{ replay.totalTime().toFixed(2) }}s
        </span>

        <div class="spacer"></div>

        <!-- Status badge -->
        @if (replay.state() === 'loading') {
          <span class="badge badge-loading">⏳ Loading signals...</span>
        }
        @if (replay.state() === 'playing') {
          <span class="badge badge-playing">▶ Replaying</span>
        }
        @if (replay.state() === 'paused') {
          <span class="badge badge-paused">⏸ Paused</span>
        }

        <!-- Speed buttons -->
        @for (s of [0.1, 0.25, 0.5, 1, 2, 4]; track s) {
          <button class="btn btn-speed"
            [class.active]="replay.speed() === s"
            (click)="replay.setSpeed(s)">
            {{ s }}x
          </button>
        }

      </div>

      <!-- Slider row -->
      <div class="row2">
        <input type="range" class="slider"
          [min]="0"
          [max]="replay.totalTime()"
          [step]="0.01"
          [value]="replay.currentTime()"
          [disabled]="replay.state() === 'idle' || replay.state() === 'loading'"
          (input)="onSlider($event)"/>
        @if (replay.pointsLoaded() > 0) {
          <span class="pts-info">
            {{ replay.pointsRendered() }} / {{ replay.pointsLoaded() }} signals
          </span>
        }
      </div>
    </div>
  `,
})
export class ReplayBarComponent {
  readonly replay = inject(ReplayEngineService);
  readonly playRequested = output<void>();
  readonly stopRequested = output<void>();
  readonly seekRequested = output<number>();

  onSlider(event: Event): void {
    const val = parseFloat((event.target as HTMLInputElement).value);
    this.seekRequested.emit(val);
    this.replay.seek(val);
  }
}
