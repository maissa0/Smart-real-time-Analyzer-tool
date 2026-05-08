import {
  Component, Output, EventEmitter, signal,
  ChangeDetectionStrategy, inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_BASE_URL } from '../../../core/config/api.config';
import { SimulatorStateService } from '../../../core/services/simulator-state.service';

@Component({
  selector: 'app-simulator-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="bg-gray-900 border border-gray-700 rounded-xl p-3 mb-3">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs font-semibold text-purple-400">🎮 CAN Simulator</span>
        @if (simId()) {
          <span class="text-xs bg-green-900 text-green-300 px-2 py-0.5 rounded-full animate-pulse">
            ● RUNNING
          </span>
        }
      </div>

      @if (!simId()) {
        <div class="space-y-2">
          <div class="flex gap-2">
            <button type="button" (click)="mode.set('random')"
              class="flex-1 text-xs py-1.5 rounded transition-colors"
              [class]="mode() === 'random'
                ? 'bg-purple-700 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'">
              🎲 Random
            </button>
            <button type="button" (click)="mode.set('replay')"
              class="flex-1 text-xs py-1.5 rounded transition-colors"
              [class]="mode() === 'replay'
                ? 'bg-purple-700 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'">
              ▶ Replay
            </button>
          </div>

          @if (mode() === 'replay') {
            <input
              [(ngModel)]="logFile"
              placeholder="C:/path/to/log_file.txt"
              class="w-full text-xs bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-gray-300 placeholder-gray-600">
          }

          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500 w-12">Speed:</span>
            <div class="flex gap-1">
              @for (s of [0.5, 1, 2, 5]; track s) {
                <button type="button" (click)="speed.set(s)"
                  class="text-xs px-2 py-1 rounded transition-colors"
                  [class]="speed() === s
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'">
                  {{ s }}x
                </button>
              }
            </div>
          </div>

          <div class="space-y-1">
            <span class="text-xs text-gray-500">Fault injection:</span>
            <div class="flex flex-wrap gap-2">
              <label class="flex items-center gap-1 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" [(ngModel)]="injectValueErrors"
                  class="accent-orange-500"> Value errors
              </label>
              <label class="flex items-center gap-1 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" [(ngModel)]="injectTimingGaps"
                  class="accent-yellow-500"> Timing gaps
              </label>
              <label class="flex items-center gap-1 text-xs text-gray-300 cursor-pointer">
                <input type="checkbox" [(ngModel)]="injectCounterErrors"
                  class="accent-red-500"> Counter errors
              </label>
            </div>
            @if (injectValueErrors || injectTimingGaps || injectCounterErrors) {
              <div class="flex items-center gap-2 mt-1">
                <span class="text-xs text-gray-500">Fault rate:</span>
                <input type="range" min="0.01" max="0.5" step="0.01"
                  [(ngModel)]="faultRate" class="flex-1 accent-orange-500">
                <span class="text-xs text-orange-400 w-8">{{ (faultRate * 100).toFixed(0) }}%</span>
              </div>
            }
          </div>

          @if (mode() === 'replay') {
            <label class="flex items-center gap-1 text-xs text-gray-300 cursor-pointer">
              <input type="checkbox" [(ngModel)]="loop" class="accent-purple-500"> Loop replay
            </label>
          }

          <button type="button" (click)="startSimulator()"
            [disabled]="starting()"
            class="w-full text-xs py-2 rounded-lg font-medium transition-colors"
            [class]="starting()
              ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
              : 'bg-purple-600 hover:bg-purple-500 text-white'">
            @if (starting()) {
              <span class="animate-pulse">Starting...</span>
            } @else {
              🚀 Start Simulator
            }
          </button>

          @if (error()) {
            <p class="text-xs text-red-400">{{ error() }}</p>
          }
        </div>
      } @else {
        <div class="space-y-2">
          <div class="text-xs text-gray-400">
            Mode: <span class="text-purple-300">{{ mode() }}</span> ·
            Speed: <span class="text-purple-300">{{ speed() }}x</span>
          </div>
          <div class="text-xs font-mono text-gray-500 truncate">ID: {{ simId() }}</div>
          <button type="button" (click)="stopSimulator()"
            class="w-full text-xs py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white font-medium transition-colors">
            ⏹ Stop Simulator
          </button>
        </div>
      }
    </div>
  `
})
export class SimulatorControlComponent {
  @Output() simulatorStarted = new EventEmitter<void>();
  @Output() simulatorStopped = new EventEmitter<void>();

  private http = inject(HttpClient);
  private simulatorState = inject(SimulatorStateService);
  private base = `${API_BASE_URL}/api/simulator`;

  mode = signal<'random' | 'replay'>('random');
  speed = signal(1);
  readonly simId = this.simulatorState.simId;
  starting = signal(false);
  error = signal<string | null>(null);

  logFile = 'C:/tools/Kpit_c/log_file.txt';
  loop = false;
  injectValueErrors = false;
  injectTimingGaps = false;
  injectCounterErrors = false;
  faultRate = 0.05;

  startSimulator(): void {
    this.starting.set(true);
    this.error.set(null);

    const body = {
      mode: this.mode(),
      logFile: this.mode() === 'replay' ? this.logFile : '',
      speed: this.speed(),
      loop: this.loop,
      injectValueErrors: this.injectValueErrors,
      injectTimingGaps: this.injectTimingGaps,
      injectCounterErrors: this.injectCounterErrors,
      faultRate: this.faultRate,
    };

    this.http.post<{ simId: string; status: string }>(
      `${this.base}/start`, body
    ).subscribe({
      next: (res) => {
        this.simulatorState.setRunning(res.simId);
        this.starting.set(false);
        this.simulatorStarted.emit();
      },
      error: (err) => {
        this.starting.set(false);
        this.error.set(err?.error?.error ?? 'Failed to start simulator');
      }
    });
  }

  stopSimulator(): void {
    const id = this.simId();
    if (!id) return;
    this.http.post(`${this.base}/stop/${id}`, {}).subscribe({
      next: () => {
        this.simulatorState.setStopped();
        this.simulatorStopped.emit();
      },
      error: () => this.simulatorState.setStopped()
    });
  }
}
