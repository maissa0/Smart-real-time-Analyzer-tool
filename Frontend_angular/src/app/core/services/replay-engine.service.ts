import { Injectable, signal, computed } from '@angular/core';

export type ReplayState = 'idle' | 'loading' | 'playing' | 'paused';

@Injectable({ providedIn: 'root' })
export class ReplayEngineService {

  // ── Master clock ──────────────────────────────────────────────────────────
  /** Current replay position in seconds (relative from 0) */
  readonly currentTime = signal<number>(0);

  /** Total duration of the session in seconds */
  readonly totalTime = signal<number>(0);

  /** Current replay state */
  readonly state = signal<ReplayState>('idle');

  /** Current speed multiplier */
  readonly speed = signal<number>(1);

  /** Number of points loaded from InfluxDB */
  readonly pointsLoaded = signal<number>(0);

  /** Number of points rendered so far */
  readonly pointsRendered = signal<number>(0);

  // ── Slider ────────────────────────────────────────────────────────────────
  readonly progress = computed(() => {
    const total = this.totalTime();
    if (total === 0) return 0;
    return Math.min(100, Math.round((this.currentTime() / total) * 100));
  });

  // ── Internal clock state ──────────────────────────────────────────────────
  private _playStartWallTime = 0;
  private _playStartLogTime = 0;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _onTick: ((currentTime: number) => void) | null = null;
  private _onSeek: ((targetTime: number) => void) | null = null;

  // ── Public API ────────────────────────────────────────────────────────────

  /** Register tick callback — called every 16ms during playback */
  onTick(cb: (currentTime: number) => void): void {
    this._onTick = cb;
  }

  /** Register seek callback — called when user drags slider */
  onSeek(cb: (targetTime: number) => void): void {
    this._onSeek = cb;
  }

  /** Start playback from current position */
  play(startLogTime?: number): void {
    const logTime = startLogTime ?? this.currentTime();
    this._playStartLogTime = logTime;
    this._playStartWallTime = Date.now();
    this.state.set('playing');
    this._startClock();
  }

  /** Pause playback — preserves current position */
  pause(): void {
    this._stopClock();
    this.state.set('paused');
  }

  /** Resume from paused position */
  resume(): void {
    this._playStartLogTime = this.currentTime();
    this._playStartWallTime = Date.now();
    this.state.set('playing');
    this._startClock();
  }

  /** Stop and reset to beginning */
  stop(): void {
    this._stopClock();
    this.currentTime.set(0);
    this.state.set('idle');
    this.pointsRendered.set(0);
  }

  /** Seek to a specific time in seconds (relative) */
  seek(targetSeconds: number): void {
    const clamped = Math.max(0, Math.min(targetSeconds, this.totalTime()));
    this.currentTime.set(clamped);
    if (this.state() === 'playing') {
      this._playStartLogTime = clamped;
      this._playStartWallTime = Date.now();
    }
    this._onSeek?.(clamped);
  }

  /** Skip forward or backward by N seconds */
  skip(seconds: number): void {
    this.seek(this.currentTime() + seconds);
  }

  /** Change speed mid-playback without losing position */
  setSpeed(newSpeed: number): void {
    const currentPos = this.currentTime();
    this.speed.set(newSpeed);
    if (this.state() === 'playing') {
      this._playStartLogTime = currentPos;
      this._playStartWallTime = Date.now();
    }
  }

  /** Set total session duration */
  setDuration(seconds: number): void {
    this.totalTime.set(seconds);
  }

  /** Set state to loading */
  setLoading(): void {
    this.state.set('loading');
  }

  /** Reset everything for a new session */
  reset(): void {
    this._stopClock();
    this.currentTime.set(0);
    this.totalTime.set(0);
    this.state.set('idle');
    this.pointsLoaded.set(0);
    this.pointsRendered.set(0);
    this._onTick = null;
    this._onSeek = null;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _startClock(): void {
    this._stopClock();
    this._timer = setInterval(() => {
      const wallElapsed = (Date.now() - this._playStartWallTime) / 1000;
      const logElapsed = wallElapsed * this.speed();
      const newTime = this._playStartLogTime + logElapsed;
      const clamped = Math.min(newTime, this.totalTime());
      this.currentTime.set(clamped);
      this._onTick?.(clamped);
      if (clamped >= this.totalTime() && this.totalTime() > 0) {
        this._stopClock();
        this.state.set('paused');
      }
    }, 16);
  }

  private _stopClock(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}
