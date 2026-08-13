import { Injectable, inject, signal, WritableSignal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { ToastService } from './toast.service';
import {
  Observable,
  Subject,
  Subscription,
  distinctUntilChanged,
  filter,
  map,
  mergeMap,
  retry,
  take,
  catchError,
  EMPTY,
} from 'rxjs';
import { RxStomp, RxStompConfig, RxStompState } from '@stomp/rx-stomp';
import SockJS from 'sockjs-client';
import { API_BASE_URL } from '../config/api.config';
import {
  CanFrame,
  DecodedSignal,
  parseSignals,
} from '../models/can.model';
import { AuthStore } from '../store/auth.store';

export interface PlaybackStartEvent    { type: 'start';    playbackId: string | null; sessionStartTs?: number; }
export interface PlaybackPointEvent    { type: 'point';    playbackId?: string | null; time: number; signalName?: string | null; value?: number | null; label?: string | null; msgId?: string | null; msgName?: string | null; }
export interface PlaybackCompleteEvent { type: 'complete'; playbackId?: string | null; }
export interface PlaybackErrorEvent    { type: 'error';    message: string; }
export type PlaybackEvent =
  | PlaybackStartEvent
  | PlaybackPointEvent
  | PlaybackCompleteEvent
  | PlaybackErrorEvent;

@Injectable({ providedIn: 'root' })
export class LiveTelemetryService {

  private rxStomp = new RxStomp();
  private frameSubject = new Subject<CanFrame>();
  private topicSubscription: Subscription | null = null;
  private playbackSubscription: Subscription | null = null;
  /** Concurrent consumers of the same session's playback topic (charts + twin). */
  private playbackRefCount = 0;
  private playbackSessionId: string | null = null;
  private sessionsSubscription: Subscription | null = null;
  private sessionsCb: ((json: string) => void) | null = null;
  private playbackSubject = new Subject<PlaybackEvent>();
  readonly playback$ = this.playbackSubject.asObservable();

  private readonly toast = inject(ToastService);
  private readonly authStore = inject(AuthStore);

  /** Tracks the active session so connectToSession() can skip redundant reconnects. */
  private currentSessionId: string | null = null;

  // Per-session frame subscriptions — keyed by sessionId to prevent memory leaks
  private frameSubscriptions = new Map<string, Subscription>();

  // Signal state — tracks latest value per signal name across all frames
  private signalStateMap = new Map<string, DecodedSignal>();
  readonly signalState: WritableSignal<Map<string, DecodedSignal>> = signal(new Map());

  // Observable projection of signalState — created in constructor (injection context required)
  private readonly _signalState$: Observable<Map<string, DecodedSignal>>;

  readonly frames$ = this.frameSubject.asObservable();
  readonly connected = signal(false);
  readonly frameCount = signal(0);
  /** Non-null when a playback stream has failed — cleared on the next successful start. */
  readonly playbackError = signal<string | null>(null);

  constructor() {
    // toObservable() must be called within an injection context — constructor satisfies this.
    this._signalState$ = toObservable(this.signalState);

    this.rxStomp.connectionState$.subscribe(state => {
      this.connected.set(state === RxStompState.OPEN);
    });
  }

  private getConfig(): RxStompConfig {
    return {
      webSocketFactory: () => new SockJS(`${API_BASE_URL}/ws-ecu-gateway`),
      // connectHeaders starts empty — populated fresh on every STOMP CONNECT
      // by beforeConnect so the token is always current (not captured at config time).
      connectHeaders: {},
      beforeConnect: (client) => {
        // Read from the signal store first (in-memory, always current), fall back
        // to localStorage for the rare case where the store hasn't hydrated yet.
        const token = this.authStore.accessToken()
          ?? localStorage.getItem('access_token')
          ?? '';
        // RxStomp v2 exposes configure() on the client instance — connectHeaders
        // is not a direct property on RxStomp, so we must update it via configure().
        client.configure({
          connectHeaders: {
            Authorization: token ? `Bearer ${token}` : '',
          },
        });
        return Promise.resolve();
      },
      heartbeatIncoming: 0,
      heartbeatOutgoing: 0,
      // 3-second delay prevents a tight retry flood when the handshake fails.
      // reconnectDelay: 0 was causing infinite rapid reconnection attempts.
      reconnectDelay: 3000,
    };
  }

  connectToSession(sessionId: string): void {
    // Skip reconnection if already subscribed to this exact session.
    // This prevents a deactivate/reactivate cycle when the component re-initialises
    // (e.g. route navigation to the same sniffer page).
    if (this.currentSessionId === sessionId && this.rxStomp.connected()) {
      return;
    }

    this.currentSessionId = sessionId;
    this.frameCount.set(0);

    // Clear only frame-level state. Tearing down the WebSocket here would cause
    // a timing race: deactivate() is async, so calling activate() immediately
    // after could start a second connection before the first fully closes.
    // The WebSocket is reused across session switches; it is only fully closed
    // by the explicit disconnect() call (e.g. on logout or component destroy).
    this.frameSubscriptions.forEach(sub => sub.unsubscribe());
    this.frameSubscriptions.clear();
    this.signalStateMap.clear();
    this.signalState.set(new Map());

    // Establish the WebSocket only if it is not already active.
    // beforeConnect() in getConfig() ensures the token is always fresh
    // regardless of when activate() was last called.
    if (!this.rxStomp.connected()) {
      this.rxStomp.configure(this.getConfig());
      this.rxStomp.activate();
    }

    const sub = this.rxStomp.watch(`/topic/frames/${sessionId}`)
      .pipe(
        map(message => {
          const parsed = JSON.parse(message.body) as CanFrame | CanFrame[];
          return Array.isArray(parsed) ? parsed : [parsed];
        }),
        mergeMap(frames => frames),
      )
      .subscribe((frame: CanFrame) => {
        this.frameCount.update(n => n + 1);
        this.frameSubject.next(frame);

        const signals = parseSignals(frame.signals);
        if (signals.length > 0) {
          signals.forEach(sig => this.signalStateMap.set(sig.signal_name, sig));
          this.signalState.set(new Map(this.signalStateMap));
        }
      });
    this.frameSubscriptions.set(sessionId, sub);

    this.rxStomp.connectionState$
      .pipe(filter(s => s === RxStompState.OPEN), take(1))
      .subscribe(() => this.attachSessionsSubscription());
  }

  /**
   * Resolves once the STOMP connection is OPEN (plus a tick so queued
   * SUBSCRIBE frames flush to the broker). Callers that trigger a server-side
   * stream (playback) must await this — the backend starts publishing within
   * milliseconds, and events published before the subscription is live are
   * silently dropped by the simple broker, leaving the client waiting forever.
   * Falls through after the timeout so a dead broker degrades to the old
   * behaviour instead of blocking the caller.
   */
  awaitConnected(timeoutMs = 5000): Promise<void> {
    return new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        sub.unsubscribe();
        clearTimeout(timer);
        // One tick after OPEN so rx-stomp flushes queued SUBSCRIBE frames first.
        setTimeout(resolve, 50);
      };
      const timer = setTimeout(done, timeoutMs);
      const sub = this.rxStomp.connectionState$
        .pipe(filter(s => s === RxStompState.OPEN), take(1))
        .subscribe(done);
      if (this.rxStomp.connected()) done();
    });
  }

  connectGlobal(): void {
    // Unsubscribe previous topic subscription only
    this.topicSubscription?.unsubscribe();
    this.topicSubscription = null;

    // Only activate if not already connected
    if (!this.rxStomp.connected()) {
      this.rxStomp.configure(this.getConfig());
      this.rxStomp.activate();
    }

    // Subscribe to global topic — receives all frames from all sessions
    this.topicSubscription = this.rxStomp.watch('/topic/live-telemetry')
      .pipe(
        map(message => {
          const parsed = JSON.parse(message.body) as CanFrame | CanFrame[];
          return Array.isArray(parsed) ? parsed : [parsed];
        }),
        mergeMap(frames => frames),
      )
      .subscribe((frame: CanFrame) => {
        this.frameCount.update(n => n + 1);
        this.frameSubject.next(frame);
        const signals = parseSignals(frame.signals);
        if (signals.length > 0) {
          signals.forEach(sig => this.signalStateMap.set(sig.signal_name, sig));
          this.signalState.set(new Map(this.signalStateMap));
        }
      });
  }

  /**
   * Registers the sessions-status callback WITHOUT activating the WebSocket.
   * Use this in ngOnInit when the caller will only start live data on demand.
   * connectToSession() calls attachSessionsSubscription() on OPEN, picking up
   * this callback automatically.  If the socket is already open (e.g. navigating
   * back to the page during an active live session), the subscription is attached
   * immediately so no status updates are missed.
   */
  setSessionsCallback(callback: (json: string) => void): void {
    this.sessionsCb = callback;
    if (this.rxStomp.connected()) {
      this.attachSessionsSubscription();
    }
  }

  subscribeToSessions(callback: (json: string) => void): void {
    this.sessionsCb = callback;
    if (!this.rxStomp.connected()) {
      this.rxStomp.configure(this.getConfig());
      this.rxStomp.activate();
      this.rxStomp.connectionState$
        .pipe(filter(s => s === RxStompState.OPEN), take(1))
        .subscribe(() => this.attachSessionsSubscription());
      return;
    }
    this.attachSessionsSubscription();
  }

  private attachSessionsSubscription(): void {
    this.sessionsSubscription?.unsubscribe();
    this.sessionsSubscription = null;
    if (!this.sessionsCb || !this.rxStomp.connected()) {
      return;
    }
    this.sessionsSubscription = this.rxStomp
      .watch('/topic/sessions')
      .subscribe(msg => this.sessionsCb!(msg.body));
  }

  /**
   * Returns an Observable<number> that emits the latest raw_value
   * for the given signal name whenever it changes.
   */
  getSignalStream(signalName: string): Observable<number> {
    return this._signalState$.pipe(
      map(stateMap => stateMap.get(signalName)?.raw_value),
      filter((value): value is number => value !== undefined),
      distinctUntilChanged(),
    );
  }

  /**
   * Returns the current snapshot of all signal values.
   */
  getSignalSnapshot(): Map<string, DecodedSignal> {
    return new Map(this.signalStateMap);
  }

  /**
   * Returns an Observable of the full signal state map —
   * useful for dashboard components showing all signals at once.
   */
  getAllSignals$(): Observable<Map<string, DecodedSignal>> {
    return this._signalState$;
  }

  isConnected(): boolean {
    return this.rxStomp.connected();
  }

  subscribeToPlayback(sessionId: string): void {
    // The charts view and the 3D twin can buffer the same session concurrently
    // (the inspector keeps both mounted). They share one STOMP watch — the
    // second subscriber must ref-count instead of killing the first one's
    // subscription mid-stream, which used to drop whole signals from whichever
    // consumer was still buffering. Consumers tell the streams apart by the
    // playbackId carried on every event.
    if (this.playbackSubscription && this.playbackSessionId === sessionId) {
      this.playbackRefCount++;
      return;
    }
    this.playbackSubscription?.unsubscribe();
    this.playbackSubscription = null;
    this.playbackRefCount = 1;
    this.playbackSessionId = sessionId;
    this.playbackError.set(null);

    // Ensure connected
    if (!this.rxStomp.connected()) {
      this.rxStomp.configure(this.getConfig());
      this.rxStomp.activate();
    }

    this.playbackSubscription = this.rxStomp
      .watch(`/topic/playback/${sessionId}`)
      .pipe(
        // The backend batches point events into arrays (one STOMP message per
        // ~500 points) for large sessions; start/complete arrive as single objects.
        map(message => {
          const parsed = JSON.parse(message.body) as PlaybackEvent | PlaybackEvent[];
          return Array.isArray(parsed) ? parsed : [parsed];
        }),
        mergeMap(events => events),
        map(event => (event.type === 'point' ? this.sanitizePlaybackPoint(event) : event)),
        retry({ count: 3, delay: 2000 }),
        catchError((err: unknown) => {
          const detail = err instanceof Error ? err.message : 'Playback failed to stream.';
          this.playbackError.set(detail);
          this.toast.error('Playback failed to stream.');
          this.playbackSubject.next({ type: 'error', message: detail });
          // Explicitly tear down the subscription so no dangling STOMP handle remains.
          this.playbackRefCount = 0;
          this.playbackSessionId = null;
          this.playbackSubscription?.unsubscribe();
          this.playbackSubscription = null;
          return EMPTY;
        }),
      )
      .subscribe(event => this.playbackSubject.next(event));
  }

  /**
   * Normalises a raw PlaybackPointEvent coming off the wire.
   *
   * value    null | undefined → 0        prevents NaN in Chart.js datasets
   * signalName null | "null"  → 'N/A'   prevents the string "null" becoming a Map key
   * label    null | ""        → 'N/A'   InfluxDB writes "" when no catalog match exists;
   *                                      treat it the same as absent so tooltips are readable
   */
  private sanitizePlaybackPoint(event: PlaybackPointEvent): PlaybackPointEvent {
    return {
      ...event,
      value: event.value != null ? event.value : 0,
      signalName: (event.signalName == null || event.signalName === 'null')
        ? 'N/A'
        : event.signalName,
      label: (event.label == null || event.label === '')
        ? 'N/A'
        : event.label,
    };
  }

  stopPlaybackSubscription(): void {
    if (this.playbackRefCount > 1) {
      this.playbackRefCount--;
      return;
    }
    this.playbackRefCount = 0;
    this.playbackSessionId = null;
    this.playbackSubscription?.unsubscribe();
    this.playbackSubscription = null;
  }

  disconnect(): void {
    this.currentSessionId = null;
    // Unsubscribe all per-session frame subscriptions
    this.frameSubscriptions.forEach(sub => sub.unsubscribe());
    this.frameSubscriptions.clear();

    this.sessionsSubscription?.unsubscribe();
    this.sessionsSubscription = null;
    this.playbackRefCount = 0;
    this.playbackSessionId = null;
    this.playbackSubscription?.unsubscribe();
    this.playbackSubscription = null;
    this.topicSubscription?.unsubscribe();
    this.topicSubscription = null;
    this.signalStateMap.clear();
    this.signalState.set(new Map());
    this.rxStomp.deactivate();
    this.connected.set(false);
  }
}
