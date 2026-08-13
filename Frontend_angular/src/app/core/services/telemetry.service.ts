import { Injectable, signal, computed } from '@angular/core';
import { CanFrame } from '../models/can.model';

export type PlaybackState = 'stopped' | 'playing' | 'paused';

@Injectable({ providedIn: 'root' })
export class TelemetryService {

  private _frames = signal<CanFrame[]>([]);
  private _playbackIndex = signal(0);
  private _state = signal<PlaybackState>('stopped');
  private _speed = signal(1);
  private _timer: any = null;
  private animationId: any = null;
  private playStartTime = 0;
  private playStartFrameIndex = 0;
  private playStartTimestamp = 0;
  /** Log-time playhead; updated every animation frame while playing for smooth UI */
  private _playheadTimestamp = signal(0);

  readonly frames = this._frames.asReadonly();
  readonly playbackIndex = this._playbackIndex.asReadonly();
  readonly state = this._state.asReadonly();
  readonly speed = this._speed.asReadonly();

  readonly visibleFrames = computed(() =>
    this._frames().slice(0, this._playbackIndex() + 1),
  );

  readonly progress = computed(() => {
    const frames = this._frames();
    if (frames.length === 0) return 0;
    if (frames.length === 1) return 100;
    const t0 = frames[0].timestamp;
    const t1 = frames[frames.length - 1].timestamp;
    if (t1 === t0) return 100;
    const t = this._playheadTimestamp();
    return Math.round(((t - t0) / (t1 - t0)) * 100);
  });

  readonly currentTime = computed(() => {
    const frames = this._frames();
    if (!frames.length) return 0;
    const first = frames[0].timestamp;
    const t = this._playheadTimestamp();
    return parseFloat((t - first).toFixed(3));
  });

  readonly totalTime = computed(() => {
    const frames = this._frames();
    if (frames.length < 2) return 0;
    return parseFloat((frames[frames.length - 1].timestamp - frames[0].timestamp).toFixed(3));
  });

  /** 0 .. (frames.length - 1), fractional — drives range input smoothly */
  readonly sliderValue = computed(() => {
    const frames = this._frames();
    const maxIdx = Math.max(0, frames.length - 1);
    if (maxIdx === 0) return 0;
    const t0 = frames[0].timestamp;
    const t1 = frames[frames.length - 1].timestamp;
    if (t1 === t0) return 0;
    const t = this._playheadTimestamp();
    return ((t - t0) / (t1 - t0)) * maxIdx;
  });

  /** Append a single frame from live streaming without full reload */
  appendLiveFrame(frame: CanFrame): void {
    this._frames.update((frames) => [...frames, frame]);
    const framesNow = this._frames();
    const lastIdx = framesNow.length > 0 ? framesNow.length - 1 : 0;
    if (this._state() === 'stopped') {
      this._playbackIndex.set(lastIdx);
    }
    this._playheadTimestamp.set(frame.timestamp);
  }

  /** Load frames for a session and reset playback */
  loadSession(frames: CanFrame[]): void {
    this.stop();
    this._frames.set(frames);
    const len = frames.length;
    const idx = len > 0 ? len - 1 : 0;
    this._playbackIndex.set(idx);
    this._playheadTimestamp.set(
      len > 0 ? frames[idx].timestamp : 0,
    );
  }

  /** Start or resume playback */
  play(): void {
    if (!this._frames().length) return;
    if (this._state() === 'stopped') {
      this._playbackIndex.set(0);
      this._playheadTimestamp.set(this._frames()[0].timestamp);
    }
    this._state.set('playing');
    const frames = this._frames();
    this.playStartTime = performance.now();
    this.playStartFrameIndex = this._playbackIndex();
    this.playStartTimestamp = frames[this._playbackIndex()].timestamp;
    this.tick();
  }

  /** Pause playback */
  pause(): void {
    this._state.set('paused');
    this.clearTimer();
  }

  /** Stop and reset to full view */
  stop(): void {
    this.clearTimer();
    this._state.set('stopped');
    const len = this._frames().length;
    const idx = len > 0 ? len - 1 : 0;
    this._playbackIndex.set(idx);
    this._playheadTimestamp.set(len > 0 ? this._frames()[idx].timestamp : 0);
  }

  /** Seek to a specific frame index */
  seekTo(index: number): void {
    const frames = this._frames();
    const clamped = Math.max(0, Math.min(index, frames.length - 1));
    this._playbackIndex.set(clamped);
    if (frames.length) {
      this._playheadTimestamp.set(frames[clamped].timestamp);
    }
    if (this._state() === 'playing') {
      this.playStartTime = performance.now();
      this.playStartFrameIndex = clamped;
      this.playStartTimestamp = frames[clamped].timestamp;
    }
  }

  /**
   * Seek using the range input’s linear position (0 .. length-1, may be fractional).
   * Maps log-time smoothly along the session span.
   */
  seekToPlayhead(linear: number): void {
    const frames = this._frames();
    if (!frames.length) return;
    const maxIdx = Math.max(0, frames.length - 1);
    const clampedLinear = Math.max(0, Math.min(linear, maxIdx));
    const t0 = frames[0].timestamp;
    const t1 = frames[maxIdx].timestamp;
    const t =
      maxIdx === 0 || t1 === t0
        ? t0
        : t0 + (clampedLinear / maxIdx) * (t1 - t0);
    let newIndex = 0;
    while (newIndex < frames.length - 1 && frames[newIndex + 1].timestamp <= t) {
      newIndex++;
    }
    this._playbackIndex.set(newIndex);
    this._playheadTimestamp.set(t);
    if (this._state() === 'playing') {
      this.playStartTime = performance.now();
      this.playStartFrameIndex = newIndex;
      this.playStartTimestamp = t;
    }
  }

  /** Set playback speed multiplier */
  setSpeed(speed: number): void {
    this._speed.set(speed);
  }

  private tick(): void {
    if (this._state() !== 'playing') return;
    const frames = this._frames();
    const elapsed = ((performance.now() - this.playStartTime) / 1000) * this._speed();
    const targetTimestamp = this.playStartTimestamp + elapsed;

    // Find the last frame whose timestamp <= targetTimestamp
    let newIndex = this.playStartFrameIndex;
    while (newIndex < frames.length - 1 && frames[newIndex + 1].timestamp <= targetTimestamp) {
      newIndex++;
    }

    this._playbackIndex.set(newIndex);

    const lastTs = frames[frames.length - 1].timestamp;
    const clampedHead = Math.min(targetTimestamp, lastTs);
    this._playheadTimestamp.set(clampedHead);

    if (newIndex >= frames.length - 1) {
      this._state.set('stopped');
      return;
    }

    this.animationId = requestAnimationFrame(() => this.tick());
  }

  private clearTimer(): void {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }
}
