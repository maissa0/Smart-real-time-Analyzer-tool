import { Injectable, signal } from '@angular/core';
import {
  BehaviorSubject,
  Observable,
  Subject,
  Subscription,
  distinctUntilChanged,
  filter,
  map,
  mergeMap,
  retry,
  catchError,
  EMPTY,
} from 'rxjs';
import { RxStomp, RxStompState } from '@stomp/rx-stomp';
import SockJS from 'sockjs-client';
import { API_BASE_URL } from '../config/api.config';
import {
  CanFrame,
  DecodedSignal,
  parseSignals,
} from '../../data/models/can.model';

@Injectable({ providedIn: 'root' })
export class LiveTelemetryService {

  private rxStomp = new RxStomp();
  private frameSubject = new Subject<CanFrame>();
  private topicSubscription: Subscription | null = null;
  private playbackSubscription: Subscription | null = null;
  private playbackSubject = new Subject<any>();
  readonly playback$ = this.playbackSubject.asObservable();

  // Global signal state map — tracks latest value per signal name across all frames
  private signalStateMap = new Map<string, DecodedSignal>();
  private signalStateSubject = new BehaviorSubject<Map<string, DecodedSignal>>(
    new Map(),
  );

  readonly frames$ = this.frameSubject.asObservable();
  readonly connected = signal(false);
  readonly frameCount = signal(0);

  constructor() {
    // Track connection state
    this.rxStomp.connectionState$.subscribe(state => {
      this.connected.set(state === RxStompState.OPEN);
    });
  }

  private getConfig(sessionId: string) {
    const token = localStorage.getItem('access_token') ?? '';
    return {
      // Use SockJS factory instead of raw WebSocket URL
      webSocketFactory: () => new SockJS(`${API_BASE_URL}/ws-ecu-gateway`),
      connectHeaders: {
        Authorization: `Bearer ${token}`,
      },
      heartbeatIncoming: 0,
      heartbeatOutgoing: 0,
      reconnectDelay: 5000,
    };
  }

  connectToSession(sessionId: string): void {
    this.frameCount.set(0);
    this.disconnect();

    this.rxStomp.configure(this.getConfig(sessionId));
    this.rxStomp.activate();

    // Subscribe to session-specific topic
    this.rxStomp.watch(`/topic/frames/${sessionId}`)
      .pipe(
        map(message => {
          const parsed = JSON.parse(message.body);
          // Handle both array (batched) and single frame
          return Array.isArray(parsed) ? parsed : [parsed];
        }),
        mergeMap(frames => frames),
      )
      .subscribe((frame: any) => {
        this.frameCount.update(n => n + 1);
        this.frameSubject.next(frame as CanFrame);

        // Update global signal state map
        const signals = parseSignals(
          typeof frame.signals === 'string'
            ? frame.signals
            : JSON.stringify(frame.signals ?? []),
        );
        if (signals.length > 0) {
          signals.forEach(sig => this.signalStateMap.set(sig.signal_name, sig));
          this.signalStateSubject.next(new Map(this.signalStateMap));
        }
      });
  }

  connectGlobal(): void {
    // Unsubscribe previous topic subscription only
    this.topicSubscription?.unsubscribe();
    this.topicSubscription = null;

    // Only activate if not already connected
    if (!this.rxStomp.connected()) {
      this.rxStomp.configure(this.getConfig('global'));
      this.rxStomp.activate();
    }

    // Subscribe to global topic — receives all frames from all sessions
    this.topicSubscription = this.rxStomp.watch('/topic/live-telemetry')
      .pipe(
        map(message => {
          const parsed = JSON.parse(message.body);
          return Array.isArray(parsed) ? parsed : [parsed];
        }),
        mergeMap(frames => frames),
      )
      .subscribe((frame: any) => {
        this.frameCount.update(n => n + 1);
        this.frameSubject.next(frame as CanFrame);
        const signals = parseSignals(
          typeof frame.signals === 'string'
            ? frame.signals
            : JSON.stringify(frame.signals ?? []),
        );
        if (signals.length > 0) {
          signals.forEach(sig => this.signalStateMap.set(sig.signal_name, sig));
          this.signalStateSubject.next(new Map(this.signalStateMap));
        }
      });
  }

  /**
   * Returns an Observable<number> that emits the latest raw_value
   * for the given signal name whenever it changes.
   * Filters frames from the global state map — no need to know the session ID.
   */
  getSignalStream(signalName: string): Observable<number> {
    return this.signalStateSubject.pipe(
      map(stateMap => stateMap.get(signalName)?.raw_value),
      filter((value): value is number => value !== undefined),
      // Only emit when value actually changes
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
    return this.signalStateSubject.asObservable();
  }

  isConnected(): boolean {
    return this.rxStomp.connected();
  }

  subscribeToPlayback(sessionId: string): void {
    this.playbackSubscription?.unsubscribe();
    this.playbackSubscription = null;

    // Ensure connected
    if (!this.rxStomp.connected()) {
      this.rxStomp.configure(this.getConfig('playback'));
      this.rxStomp.activate();
    }

    this.playbackSubscription = this.rxStomp
      .watch(`/topic/playback/${sessionId}`)
      .pipe(
        map(message => JSON.parse(message.body)),
        retry({ count: 3, delay: 2000 }),
        catchError(err => {
          console.error('Playback WebSocket error after 3 retries:', err);
          this.playbackSubject.next({ type: 'error', message: 'Connection lost. Please restart playback.' });
          return EMPTY;
        }),
      )
      .subscribe(point => this.playbackSubject.next(point));
  }

  stopPlaybackSubscription(): void {
    this.playbackSubscription?.unsubscribe();
    this.playbackSubscription = null;
  }

  disconnect(): void {
    this.playbackSubscription?.unsubscribe();
    this.playbackSubscription = null;
    this.topicSubscription?.unsubscribe();
    this.topicSubscription = null;
    this.signalStateMap.clear();
    this.signalStateSubject.next(new Map());
    this.rxStomp.deactivate();
    this.connected.set(false);
  }
}
