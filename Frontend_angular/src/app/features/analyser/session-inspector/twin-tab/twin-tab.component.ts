import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ViewChild,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, firstValueFrom, of, catchError, interval, switchMap, filter, take, defaultIfEmpty } from 'rxjs';
import { LiveTelemetryService } from '../../../../core/services/live-telemetry.service';
import { CanService } from '../../../../core/services/can.service';
import { CanSession, DecodedSignal, DiagnosticReport, FaultContextSignal, FullReport, IntegrityFault, hasEnumLabel } from '../../../../core/models/can.model';
import { SessionSummary, SessionSummaryService } from '../../../../core/services/session-summary.service';
import {
  FaultReportService,
  ReportFaultRow,
  ReportSignalRow,
} from '../../../../core/services/fault-report.service';

declare function createUnityInstance(
  canvas: HTMLCanvasElement,
  config: Record<string, unknown>,
  onProgress?: (progress: number) => void
): Promise<UnityInstance>;

interface UnityInstance {
  SendMessage(gameObjectName: string, methodName: string, value: string): void;
  Quit(): Promise<void>;
}

/** GameObject name in the Unity scene that CanBridge.cs is attached to. */
const CAR_ROOT_OBJECT = 'CarRoot';
/** GameObject name in the Unity scene that KeyController.cs is attached to. */
const KEY_ROOT_OBJECT = 'KeyRoot';

/** Canonical twin channels (the names CanBridge switches on) + tracked for the
 *  health cards. CanBridge ignores the ones it has no case for
 *  (Steering_Validity / EPS_State / Hood_Status — health only). */
const WATCHED_SIGNALS = new Set([
  'Drd_Status', 'PSD_Status', 'DRDR_Status', 'Psdr_Status',
  'Bootlid_Status', 'Hood_Status', 'Wiper_State', 'SteeringAngle_High',
  'Wheel_Speed_FL', 'Wheel_Speed_FR', 'Wheel_Speed_RL', 'Wheel_Speed_RR',
  'Window_FL', 'Window_FR', 'Window_RL', 'Window_RR',
  'Steering_Validity', 'EPS_State',
]);

/** One twin channel: canonical CanBridge name, a dynamic matcher for whatever
 *  the session's catalogue calls that signal, and a value normalizer into the
 *  units CanBridge expects. */
interface TwinBinding {
  canonical: string;
  match: RegExp;
  /** Must be the identity for values already in canonical units. */
  convert: (raw: number) => number;
}

const asFlag = (v: number) => (v !== 0 ? 1 : 0);
/** ≤3 → already the 0-3 speed enum; otherwise treat as km/h and quantize
 *  to CanBridge's Stationary/Slow/Normal/Fast buckets. */
const asWheelEnum = (v: number) => (v <= 3 ? v : v < 30 ? 1 : v < 70 ? 2 : 3);
/** ≤6 → already the SteeringAngle_High enum; otherwise an offset-encoded
 *  byte (128 = centre, <128 left, >128 right) → nearest enum step. */
const asSteeringEnum = (v: number) => {
  if (v <= 6) return v;
  const d = v - 128;
  const abs = Math.abs(d);
  if (abs < 8) return 0;
  const mag = abs >= 64 ? 3 : abs >= 24 ? 2 : 1; // slight / hard / full-lock
  return d < 0 ? [0, 1, 2, 5][mag] : [0, 3, 4, 6][mag];
};

/** Matched in order (first hit wins), case-insensitive, against every signal
 *  name in the session — so the 3D twin works with any catalogue's naming
 *  (e.g. `E2E_Door_FL_State`, `E2E_Wiper_Mode`, `E2E_Wheel_Speed_FR`)
 *  instead of only the exact BMW names CanBridge was written for. */
const TWIN_BINDINGS: TwinBinding[] = [
  { canonical: 'Drd_Status',         match: /^drd_status$|door.*f.?l|f.?l.*door/i,  convert: asFlag },
  { canonical: 'PSD_Status',         match: /^psd_status$|door.*f.?r|f.?r.*door/i,  convert: asFlag },
  { canonical: 'DRDR_Status',        match: /^drdr_status$|door.*r.?l|r.?l.*door/i, convert: asFlag },
  { canonical: 'Psdr_Status',        match: /^psdr_status$|door.*r.?r|r.?r.*door/i, convert: asFlag },
  { canonical: 'Bootlid_Status',     match: /bootlid|trunk|decklid/i,               convert: asFlag },
  { canonical: 'Hood_Status',        match: /hood|bonnet/i,                         convert: asFlag },
  // Window positions may be percentages (0-100 % open) — any non-zero = open.
  { canonical: 'Window_FL',          match: /window.*f.?l|f.?l.*window/i,           convert: asFlag },
  { canonical: 'Window_FR',          match: /window.*f.?r|f.?r.*window/i,           convert: asFlag },
  { canonical: 'Window_RL',          match: /window.*r.?l|r.?l.*window/i,           convert: asFlag },
  { canonical: 'Window_RR',          match: /window.*r.?r|r.?r.*window/i,           convert: asFlag },
  { canonical: 'Wiper_State',        match: /wiper/i,                               convert: (v) => v },
  { canonical: 'Wheel_Speed_FL',     match: /wheel.*speed.*f.?l/i,                  convert: asWheelEnum },
  { canonical: 'Wheel_Speed_FR',     match: /wheel.*speed.*f.?r/i,                  convert: asWheelEnum },
  { canonical: 'Wheel_Speed_RL',     match: /wheel.*speed.*r.?l/i,                  convert: asWheelEnum },
  { canonical: 'Wheel_Speed_RR',     match: /wheel.*speed.*r.?r/i,                  convert: asWheelEnum },
  { canonical: 'Steering_Validity',  match: /steer.*valid/i,                        convert: (v) => v },
  { canonical: 'EPS_State',          match: /eps_state|^eps/i,                      convert: (v) => v },
  { canonical: 'SteeringAngle_High', match: /steer/i,                               convert: asSteeringEnum },
];

/** Canonical twin channel → CanBridge.FocusPart id: when one of these actually
 *  changes (and was forwarded to Unity), the showroom camera swings around to
 *  frame that part for a few seconds. Steering is absent on purpose — it has
 *  its own PiP camera. */
const FOCUS_PARTS: Record<string, string> = {
  Drd_Status: 'door_fl',
  PSD_Status: 'door_fr',
  DRDR_Status: 'door_rl',
  Psdr_Status: 'door_rr',
  Bootlid_Status: 'trunk',
  Hood_Status: 'hood',
  Window_FL: 'window_fl',
  Window_FR: 'window_fr',
  Window_RL: 'window_rl',
  Window_RR: 'window_rr',
  Wiper_State: 'wiper',
  Wheel_Speed_FL: 'wheel_fl',
  Wheel_Speed_FR: 'wheel_fr',
  Wheel_Speed_RL: 'wheel_rl',
  Wheel_Speed_RR: 'wheel_rr',
};

/** Showroom-camera rotation slider bounds (°/s) — mirrors ShowroomCamera's clamp. */
const ORBIT_SPEED_DEFAULT = 30;
const ORBIT_SPEED_MAX = 90;

const DOOR_SIGNALS = ['Drd_Status', 'PSD_Status', 'DRDR_Status', 'Psdr_Status'];
const WHEEL_SIGNALS = ['Wheel_Speed_FL', 'Wheel_Speed_FR', 'Wheel_Speed_RL', 'Wheel_Speed_RR'];
const WHEEL_LABELS = ['Stationary', 'Slow', 'Normal', 'Fast'];
const WIPER_LABELS = ['Off', 'Intermittent', 'Low', 'High'];

const TICK_MS = 100;
const REPLAY_SPEEDS = [0.5, 1, 2] as const;
/** Max history entries kept per signal in live mode (bounded memory). */
const LIVE_HISTORY_CAP = 500;

/** Roster row for faults that match no signal/message row. */
const OTHER_FAULTS_KEY = '⚠ Other faults';

/** Existing app design tokens (session-inspector / sniffer palette). */
const COLOR_OK = '#b0ff44';
const COLOR_FAULT = '#ff5a5a';     // fault → red (fallback / unmatched fault type)
const COLOR_UNDECODED = '#ffb545'; // not in catalogue → amber
const COLOR_MUTED = '#8a9ab0';

/** Zones reported by KeyController via the 'unity-keystate' window event. */
type KeyZone = 'inside' | 'outside' | 'unknown';
const KEY_ZONE_META: Record<KeyZone, { label: string; color: string }> = {
  inside:  { label: 'Inside car',   color: COLOR_OK },
  outside: { label: 'On podium',    color: COLOR_UNDECODED },
  unknown: { label: 'Out of range', color: COLOR_MUTED },
};

/** Direct key-position signal (key_can.xml `KEY_Pos` on 0x723):
 *  1 = Inside, 2 = Outside, 3 = Unknown. Authoritative when present. */
const KEY_POS_RE = /^key_?pos/i;
const keyZoneFromKeyPos = (name: string, value: number): KeyZone | null => {
  if (!KEY_POS_RE.test(name)) return null;
  return value === 1 ? 'inside' : value === 2 ? 'outside' : value === 3 ? 'unknown' : null;
};

/** Fallback inference for sessions without a KEY_Pos signal: key-fob events
 *  place the key, driving pulls it inside. Fob semantics follow the e2e
 *  catalogue (`E2E_Lock_Request`): 1 = Lock pressed (owner walking away),
 *  2 = Unlock, 3 = Trunk release (owner at the car). */
const KEY_FOB_RE = /lock.*request|remote|fob/i;
const KEY_GEAR_RE = /gear/i;
const keyZoneFromSignal = (name: string, value: number): KeyZone | null => {
  if (KEY_FOB_RE.test(name)) {
    return value === 1 ? 'unknown' : value === 2 || value === 3 ? 'outside' : null;
  }
  if (KEY_GEAR_RE.test(name)) {
    return value >= 1 ? 'inside' : null;
  }
  return null;
};

/** Same per-fault-type colors as the sniffer's Integrity tab, for a consistent
 *  visual language across the app. */
const FAULT_TYPE_COLORS: Record<string, string> = {
  DUPLICATE: '#fb923c',     // orange
  TIMING_GAP: '#fbbf24',    // amber
  SIGNAL_RANGE: '#f87171',  // red
  COUNTER_ERROR: '#c084fc', // purple
};
const FAULT_TYPE_LABELS: Record<string, string> = {
  DUPLICATE: 'DUPLICATE',
  TIMING_GAP: 'TIMING GAP',
  SIGNAL_RANGE: 'RANGE',
  COUNTER_ERROR: 'COUNTER ERR',
};

type LoadState = 'loading' | 'ready' | 'error';
type ReplayState = 'idle' | 'buffering' | 'active';
type RowStatus = 'ok' | 'fault' | 'undecoded';

interface TimelinePoint {
  time: number;
  name: string;
  value: number;
  /** Raw catalogue label; 'N/A' when the value has no enum match. */
  label: string;
  msgId: string;
  /** True for frames whose msg ID has no catalogue entry at all. */
  undecoded: boolean;
  /** Server playback id the point arrived on — filters out concurrent streams. */
  pid?: string;
}
/** Same union as IntegrityFault.faultType — aliased so the roster/history types stay in sync. */
type FaultType = IntegrityFault['faultType'];

interface RosterRow {
  key: string;
  msgId: string;
  display: string;
  status: RowStatus;
  /** Set when status === 'fault' — which check flagged it (colors the pill). */
  faultType?: FaultType | null;
}
/** One recorded value of a signal, for the click-to-expand history view. */
interface HistoryEntry {
  t: number;
  display: string;
  undecoded: boolean;
  /** Set only for the exact frame(s) where this signal actually faulted. */
  faultType: FaultType | null;
}
interface Marker { pct: number; color: string; }
interface HealthCard { label: string; value: string; color: string; }

@Component({
  selector: 'app-twin-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  styles: [`
    :host {
      display: flex; flex-direction: column; height: 100%; flex: 1; min-height: 0;
      background: #07090b; overflow: hidden;
    }

    .main-row { flex: 1; display: flex; gap: 12px; padding: 6px 12px; min-height: 0; }

    /* ── Main stage ── */
    .stage {
      flex: 1; position: relative; background: #14171c;
      border: 1px solid rgba(255,255,255,.08); border-radius: 10px;
      overflow: hidden; min-width: 0;
    }
    .stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; outline: none; }

    /* Bottom-left: the top-left corner belongs to Unity's in-canvas KEY
       POSITION panel (KeyController.OnGUI) — anchoring here avoids overlapping
       it at any canvas resolution. */
    .frame-pill {
      position: absolute; bottom: 14px; left: 14px; display: flex; align-items: center; gap: 8px;
      background: rgba(13,15,18,.55); backdrop-filter: blur(6px);
      border: 1px solid rgba(255,255,255,.1); border-radius: 7px; padding: 6px 10px; z-index: 3;
    }
    .frame-pill .dot { width: 7px; height: 7px; border-radius: 50%; }
    .frame-pill .dot.playing { background: #b0ff44; animation: dtw-pulse 1.2s ease-in-out infinite; }
    .frame-pill .dot.paused { background: rgba(232,234,237,.3); }
    @keyframes dtw-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
    .frame-pill span.text { font-size: 11.5px; color: rgba(232,234,237,.75); }

    /* Top-right toolbar: Export + Steering. */
    .stage-tools {
      position: absolute; top: 14px; right: 14px; z-index: 3;
      display: flex; gap: 8px; align-items: center;
    }
    .tool-btn {
      background: rgba(13,15,18,.6); backdrop-filter: blur(6px);
      border: 1px solid rgba(255,255,255,.12); color: rgba(232,234,237,.8);
      font-size: 11.5px; font-weight: 600; border-radius: 7px; padding: 6px 11px;
      cursor: pointer; white-space: nowrap;
    }
    .tool-btn:hover:not(:disabled) { border-color: rgba(176,255,68,.35); color: #b0ff44; }
    .tool-btn:disabled { opacity: .5; cursor: default; }
    .tool-btn.primary { border-color: rgba(176,255,68,.35); color: #b0ff44; background: rgba(176,255,68,.1); }
    .tool-btn.primary:hover:not(:disabled) { background: rgba(176,255,68,.18); }

    /* Showroom rotation-speed slider — same pill styling as the tool buttons. */
    .speed-ctl {
      display: flex; align-items: center; gap: 7px;
      background: rgba(13,15,18,.6); backdrop-filter: blur(6px);
      border: 1px solid rgba(255,255,255,.12); border-radius: 7px; padding: 5px 11px;
    }
    .speed-ctl .lbl { font-size: 12px; color: rgba(232,234,237,.8); }
    .speed-ctl input[type=range] { width: 84px; accent-color: #b0ff44; cursor: pointer; }
    .speed-ctl .val {
      font-size: 11px; font-family: ui-monospace, Menlo, monospace;
      color: rgba(232,234,237,.6); min-width: 40px; text-align: right;
    }

    /* Frame around the Unity PiP camera region (bottom-right of the canvas). */
    .steer-frame {
      position: absolute; right: 3%; bottom: 4%; width: 25%; height: 30%;
      border: 1px solid rgba(255,255,255,.12); border-radius: 9px; z-index: 2;
      pointer-events: none; box-shadow: 0 8px 24px rgba(0,0,0,.4);
    }
    .steer-frame .title {
      font-size: 10px; font-weight: 700; letter-spacing: .5px; color: rgba(232,234,237,.6);
      padding: 4px 9px; background: rgba(13,15,18,.7); border-radius: 8px 8px 0 0;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }

    .overlay {
      position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 1rem; z-index: 5;
      color: #8a9ab0; font-size: 0.82rem; text-align: center; padding: 2rem; background: #14171c;
    }
    .overlay h3 { color: #e6edf3; font-size: 1rem; margin: 0; }
    .spinner {
      width: 24px; height: 24px; border: 2px solid #21262d; border-top-color: #b0ff44;
      border-radius: 50%; animation: spin .8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
    .progress-text { font-size: .72rem; color: #484f58; }
    .error-text { color: #ff6b6b; font-size: .75rem; max-width: 420px; }
    .twin-icon {
      width: 64px; height: 64px; border-radius: 16px; font-size: 1.75rem;
      background: rgba(176,255,68,.08); border: 1px solid rgba(176,255,68,.2);
      display: flex; align-items: center; justify-content: center;
    }

    /* ── Side panel ──
       Own scrollbar (overflow-y) as an outer fallback: the cards + both tables
       have a minimum height each, so on a short viewport they no longer get
       squeezed to nothing — the whole side section scrolls instead, on top of
       (not instead of) each table's own internal .event-list scroll. */
    .side { width: 460px; flex: none; display: flex; flex-direction: column; gap: 12px; min-height: 0; overflow-y: auto; }

    .cards { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; flex: none; }
    .card {
      background: #14171c; border: 1px solid rgba(255,255,255,.08); border-radius: 8px;
      padding: 9px 11px; display: flex; flex-direction: column; gap: 5px;
    }
    .card .label { font-size: 10.5px; color: rgba(232,234,237,.45); letter-spacing: .3px; }
    .card .val { display: flex; align-items: center; gap: 6px; }
    .card .val .dot { width: 6px; height: 6px; border-radius: 50%; }
    .card .val span.text { font-size: 12.5px; font-weight: 600; }

    .event-panel {
      flex: 1; min-height: 320px; background: #14171c; border: 1px solid rgba(255,255,255,.08); border-radius: 10px;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .event-panel .head {
      padding: 11px 14px; border-bottom: 1px solid rgba(255,255,255,.08);
      font-size: 12px; font-weight: 700; letter-spacing: .3px; color: rgba(232,234,237,.7); flex: none;
    }
    .event-cols {
      display: grid; grid-template-columns: 1fr 110px 56px; gap: 6px; padding: 8px 14px 6px;
      font-size: 10px; font-weight: 600; letter-spacing: .3px; color: rgba(232,234,237,.35); flex: none;
    }
    .event-list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
    .event-row {
      display: grid; grid-template-columns: 1fr 110px 56px; gap: 6px; align-items: center;
      padding: 7px 6px; border-radius: 6px; margin-bottom: 2px; background: transparent;
      border-left: 2px solid transparent;
    }
    /* .st-fault's border-left-color/background are now set per-fault-type via
       [style.*] bindings (see faultTypeColor/faultBg) — this class only keeps
       a border so the row has a left accent before JS sets the real color. */
    .event-row.st-fault { border-left-color: ${COLOR_FAULT}; }
    .event-row.st-undecoded { border-left-color: ${COLOR_UNDECODED}; }
    .event-row.active { background: rgba(176,255,68,.1); }
    .event-row .label {
      font-size: 11.5px; color: rgba(232,234,237,.85);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .event-row.active .label { font-weight: 700; }
    .event-row .value {
      font-size: 11.5px; font-weight: 600; font-family: ui-monospace, Menlo, monospace;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .event-row .status { font-size: 10px; font-weight: 700; letter-spacing: .2px; }
    .event-row { cursor: pointer; }
    .event-row:hover { background: rgba(255,255,255,.05); }
    .event-row.selected { background: rgba(176,255,68,.07); }
    .event-empty { padding: 1rem; font-size: .72rem; color: #484f58; text-align: center; }

    /* ── Signal history popup (notification-style card over the stage) ── */
    .history-popup {
      position: absolute; top: 56px; right: 14px; width: 300px; max-height: 70%;
      display: flex; flex-direction: column; z-index: 6;
      background: rgba(13,15,18,.92); backdrop-filter: blur(8px);
      border: 1px solid rgba(176,255,68,.25); border-radius: 10px;
      box-shadow: 0 12px 32px rgba(0,0,0,.55); overflow: hidden;
      animation: hp-slide .18s ease-out;
    }
    @keyframes hp-slide { from { transform: translateX(16px); opacity: 0; } to { transform: none; opacity: 1; } }
    .history-popup .hp-head {
      display: flex; align-items: center; gap: 8px; padding: 9px 12px; flex: none;
      border-bottom: 1px solid rgba(255,255,255,.08);
    }
    .history-popup .hp-title {
      flex: 1; font-size: 12px; font-weight: 700; color: #e6edf3;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .history-popup .hp-count { font-size: 10px; color: rgba(232,234,237,.45); flex: none; }
    .history-popup .hp-close {
      background: none; border: none; color: rgba(232,234,237,.5); cursor: pointer;
      font-size: 13px; line-height: 1; padding: 2px 4px; flex: none;
    }
    .history-popup .hp-close:hover { color: #ff6b6b; }
    .history-popup .hp-list { overflow-y: auto; }
    .history-row {
      display: flex; justify-content: space-between; gap: 10px; padding: 5px 12px;
      font-size: 11px; font-family: ui-monospace, Menlo, monospace;
      border-bottom: 1px solid rgba(255,255,255,.04);
    }
    .history-row:last-child { border-bottom: none; }
    .history-row .ht { color: rgba(232,234,237,.4); flex: none; }
    .history-row .hv { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .history-row .hf {
      font-size: 9px; font-weight: 700; letter-spacing: .3px; margin-left: 6px;
      padding: 1px 4px; border-radius: 3px; white-space: nowrap;
      /* background/color set per-fault-type via [style.*] bindings */
    }

    /* ── Replay bar ── */
    .replay-bar {
      flex: none; border-top: 1px solid rgba(255,255,255,.08); background: #0d1117;
      padding: 8px 20px; display: flex; flex-direction: column; gap: 6px;
    }
    .scrub-wrap { position: relative; height: 20px; display: flex; align-items: center; }
    .scrub-wrap input[type=range] {
      width: 100%; accent-color: #b0ff44; position: relative; z-index: 2; background: transparent;
      cursor: pointer;
    }
    .scrub-wrap input[type=range]:disabled { cursor: not-allowed; opacity: .4; }
    .marker {
      position: absolute; top: 8px; width: 3px; height: 8px; border-radius: 1px;
      pointer-events: none; z-index: 1;
    }
    .transport { display: flex; align-items: center; gap: 16px; }
    .btn-play {
      width: 34px; height: 34px; border-radius: 50%; background: #b0ff44; color: #0b0d10;
      border: none; font-size: 13px; cursor: pointer; display: flex; align-items: center;
      justify-content: center; flex: none; font-weight: 700;
    }
    .btn-play:disabled { opacity: .4; cursor: not-allowed; }
    .time-label { font-size: 12px; font-family: ui-monospace, Menlo, monospace; color: rgba(232,234,237,.6); flex: none; }
    .transport .spacer { flex: 1; }
    .speed-group { display: flex; gap: 4px; flex: none; }
    .btn-speed {
      font-size: 11.5px; font-weight: 600; padding: 5px 10px; border-radius: 6px;
      border: 1px solid rgba(255,255,255,.1); background: transparent;
      color: rgba(232,234,237,.55); cursor: pointer;
    }
    .btn-speed.active { border-color: rgba(176,255,68,.5); background: rgba(176,255,68,.12); color: #b0ff44; }
    .frame-count { font-size: 11px; color: rgba(232,234,237,.4); flex: none; }
    .replay-hint { font-size: 11px; color: #484f58; flex: none; }
  `],
  template: `
    <div class="main-row">
      <!-- Main stage: Unity viewport + overlays -->
      <div class="stage">
        <!-- id is required: Unity's input system resolves its event target via
             querySelector('#' + canvas.id) and crashes on an id-less canvas. -->
        <canvas #unityCanvas id="unity-canvas"></canvas>

        <div class="frame-pill">
          <span class="dot" [class.playing]="playing() || isLive()" [class.paused]="!playing() && !isLive()"></span>
          <span class="text">Frame {{ currentFrameLabel() }} / {{ totalFramesLabel() }}</span>
        </div>

        <div class="stage-tools">
          <div class="speed-ctl" title="Showroom rotation speed (0 = stopped)">
            <span class="lbl">⟳</span>
            <input type="range" min="0" [max]="orbitSpeedMax" step="1"
                   [value]="orbitSpeed()" (input)="onOrbitSpeedInput($event)" />
            <span class="val">{{ orbitSpeed() }}°/s</span>
          </div>
          <button class="tool-btn" (click)="toggleFocus()"
                  [title]="focusEnabled()
                    ? 'Camera swings to parts when something happens — click to keep it rotating instead'
                    : 'Event zoom is off — the camera just keeps rotating'">
            {{ focusEnabled() ? 'Focus: On' : 'Focus: Off' }}
          </button>
          <button class="tool-btn primary" [disabled]="exporting() || loadState() !== 'ready'"
                  (click)="exportReport()">
            {{ exporting() ? 'Exporting…' : '⤓ Export Report' }}
          </button>
          <button class="tool-btn" (click)="toggleSteering()">
            {{ showSteering() ? 'Hide Steering' : 'Show Steering' }}
          </button>
        </div>

        @if (showSteering()) {
          <div class="steer-frame">
            <div class="title">STEERING WHEEL</div>
          </div>
        }

        <!-- Signal history popup (opened by clicking a row in either table) -->
        @if (selectedSignalKey(); as sel) {
          <div class="history-popup">
            <div class="hp-head">
              <div class="hp-title" [title]="sel">{{ sel }}</div>
              <div class="hp-count">{{ selectedHistory().length }} values</div>
              <button class="hp-close" (click)="onRowClick(sel)">✕</button>
            </div>
            <div class="hp-list">
              @if (selectedHistory().length === 0) {
                <div class="event-empty">No recorded values yet.</div>
              }
              @for (h of selectedHistory(); track $index) {
                <div class="history-row">
                  <span class="ht">{{ fmtTime(h.t) }}</span>
                  <span class="hv"
                        [style.color]="h.faultType ? faultTypeColor(h.faultType) : h.undecoded ? '${COLOR_UNDECODED}' : 'rgba(232,234,237,.85)'">
                    {{ h.display }}@if (h.faultType) {
                      <span class="hf" [style.background]="faultBg(h.faultType)" [style.color]="faultTypeColor(h.faultType)">
                        {{ faultTypeShortLabel(h.faultType) }}
                      </span>
                    }
                  </span>
                </div>
              }
            </div>
          </div>
        }

        @if (loadState() === 'loading') {
          <div class="overlay">
            <div class="spinner"></div>
            <h3>Loading 3D Digital Twin…</h3>
            <span class="progress-text">{{ progressPct() }}%</span>
          </div>
        } @else if (loadState() === 'error') {
          <div class="overlay">
            <div class="twin-icon">⚠</div>
            <h3>3D Twin failed to load</h3>
            <span class="error-text">{{ errorMessage() }}</span>
          </div>
        }
      </div>

      <!-- Side panel: health cards + signal list -->
      <div class="side">
        <div class="cards">
          @for (card of healthCards(); track card.label) {
            <div class="card">
              <div class="label">{{ card.label }}</div>
              <div class="val">
                <span class="dot" [style.background]="card.color"></span>
                <span class="text" [style.color]="card.color">{{ card.value }}</span>
              </div>
            </div>
          }
        </div>

        <div class="event-panel">
          <div class="head">SIGNALS</div>
          <div class="event-cols"><div>SIGNAL</div><div>VALUE</div><div>STATUS</div></div>
          <div class="event-list" #logList>
            @if (rosterRows().length === 0) {
              <div class="event-empty">
                {{ isLive()
                    ? 'Waiting for live signals…'
                    : replayState() === 'buffering'
                      ? 'Loading session signals…'
                      : 'Press play to load the session signals.' }}
              </div>
            }
            @for (row of rosterRows(); track row.key) {
              <div class="event-row"
                   [attr.data-key]="row.key"
                   [class.active]="row.key === lastChangedKey()"
                   [class.selected]="row.key === selectedSignalKey()"
                   [class.st-fault]="row.status === 'fault'"
                   [class.st-undecoded]="row.status === 'undecoded'"
                   [style.border-left-color]="row.status === 'fault' ? faultTypeColor(row.faultType) : null"
                   [style.background]="row.status === 'fault' ? faultBg(row.faultType) : null"
                   (click)="onRowClick(row.key)">
                <div class="label" [title]="row.key">{{ row.key }}</div>
                <div class="value" [style.color]="statusColor(row.status, row.faultType)" [title]="row.display">{{ row.display }}</div>
                <div class="status" [style.color]="statusColor(row.status, row.faultType)">{{ statusLabel(row.status, row.faultType) }}</div>
              </div>
            }
          </div>
        </div>

        <div class="event-panel">
          <div class="head">UNDECODED SIGNALS</div>
          <div class="event-cols"><div>SIGNAL</div><div>VALUE</div><div>STATUS</div></div>
          <div class="event-list" #undecList>
            @if (undecodedRows().length === 0) {
              <div class="event-empty">
                {{ isLive()
                    ? 'No undecoded signals yet.'
                    : replayState() === 'buffering'
                      ? 'Loading session signals…'
                      : 'No undecoded signals in this session.' }}
              </div>
            }
            @for (row of undecodedRows(); track row.key) {
              <div class="event-row"
                   [attr.data-key]="row.key"
                   [class.active]="row.key === lastChangedKey()"
                   [class.selected]="row.key === selectedSignalKey()"
                   [class.st-undecoded]="true"
                   (click)="onRowClick(row.key)">
                <div class="label" [title]="row.key">{{ row.key }}</div>
                <div class="value" [style.color]="statusColor(row.status)" [title]="row.display">{{ row.display }}</div>
                <div class="status" [style.color]="statusColor(row.status)">{{ statusLabel(row.status) }}</div>
              </div>
            }
          </div>
        </div>
      </div>
    </div>

    <!-- Replay bar -->
    <div class="replay-bar">
      <div class="scrub-wrap">
        <input type="range" min="0" [max]="duration()" step="0.01"
               [value]="elapsed()" [disabled]="replayState() !== 'active'"
               (input)="onSeekInput($event)" />
        @for (m of markers(); track $index) {
          <div class="marker" [style.left.%]="m.pct" [style.background]="m.color"></div>
        }
      </div>
      <div class="transport">
        <button class="btn-play" (click)="onPlayClick()" [disabled]="!canPlay()">
          {{ playing() ? '❚❚' : '▶' }}
        </button>
        <div class="time-label">{{ fmtTime(elapsed()) }} / {{ fmtTime(duration()) }}</div>
        @if (replayState() === 'buffering') {
          <span class="replay-hint">Loading session data…</span>
        } @else if (isLive()) {
          <span class="replay-hint">LIVE — replay available when the session completes</span>
        }
        <div class="spacer"></div>
        <div class="speed-group">
          @for (s of speeds; track s) {
            <button class="btn-speed" [class.active]="speed() === s" (click)="speed.set(s)">{{ s }}x</button>
          }
        </div>
        <div class="frame-count">Frame {{ currentFrameLabel() }} / {{ totalFramesLabel() }}</div>
      </div>
    </div>
  `,
})
export class TwinTabComponent implements AfterViewInit, OnChanges, OnDestroy {
  @Input() sessionId = '';
  @Input() session: CanSession | null = null;
  /** External seek request ("Twin @ t" evidence links) — t in seconds from replay start;
   *  token distinguishes repeat requests to the same t. */
  @Input() seekTo: { t: number; token: number } | null = null;
  @ViewChild('unityCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('logList') logListRef?: ElementRef<HTMLDivElement>;
  @ViewChild('undecList') undecListRef?: ElementRef<HTMLDivElement>;

  private readonly liveTelemetry = inject(LiveTelemetryService);
  private readonly canService = inject(CanService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly summaryService = inject(SessionSummaryService);
  private readonly faultReport = inject(FaultReportService);

  loadState = signal<LoadState>('loading');
  errorMessage = signal('');
  progressPct = signal(0);

  readonly speeds = REPLAY_SPEEDS;
  replayState = signal<ReplayState>('idle');
  playing = signal(false);
  speed = signal<number>(1);
  elapsed = signal(0);
  duration = signal(0);
  showSteering = signal(false);
  /** True while a fault-report PDF export is in progress (disables the button). */
  exporting = signal(false);
  /** Showroom-camera rotation speed in °/s (0 = stopped) — toolbar slider. */
  orbitSpeed = signal(ORBIT_SPEED_DEFAULT);
  readonly orbitSpeedMax = ORBIT_SPEED_MAX;
  /** Event-focus toggle — off = the camera never swings to parts, it just keeps rotating. */
  focusEnabled = signal(true);

  /** Latest known value per watched signal — feeds the health cards + Unity. */
  currentState = signal<Map<string, number>>(new Map());

  /** Electronic-key zone reported by Unity's KeyController (null until known). */
  keyState = signal<KeyZone | null>(null);

  /** Fixed signal list: one row per signal (or undecodable msg ID), updated in place. */
  roster = signal<Map<string, RosterRow>>(new Map());
  /** Row highlighted as "most recently changed" — stays lit until another changes. */
  lastChangedKey = signal<string | null>(null);
  markers = signal<Marker[]>([]);

  /** Signal whose full value history is expanded under its row (null = none). */
  selectedSignalKey = signal<string | null>(null);
  selectedHistory = signal<HistoryEntry[]>([]);

  /** Catalogued signals (ok/fault) — the undecoded ones get their own table below. */
  rosterRows = computed<RosterRow[]>(() => {
    const rows = [...this.roster().values()].filter(r => r.status !== 'undecoded');
    rows.sort((a, b) => {
      if (a.key === OTHER_FAULTS_KEY) return 1;
      if (b.key === OTHER_FAULTS_KEY) return -1;
      return a.key.localeCompare(b.key);
    });
    return rows;
  });

  /** Signals with no catalogue enum match, plus frames whose msg ID is unknown. */
  undecodedRows = computed<RosterRow[]>(() => {
    const rows = [...this.roster().values()].filter(r => r.status === 'undecoded');
    rows.sort((a, b) => a.key.localeCompare(b.key));
    return rows;
  });

  isLive = computed(() => this.session?.status?.toUpperCase() === 'LIVE');

  canPlay = computed(() =>
    this.loadState() === 'ready' && !this.isLive() &&
    (this.replayState() === 'active' || (this.replayState() === 'idle' && !!this.session))
  );

  currentFrameLabel = computed(() => {
    const total = this.session?.frameCount ?? 0;
    if (this.replayState() !== 'active' || this.duration() <= 0) {
      return this.isLive() ? this.liveTelemetry.frameCount().toLocaleString() : '0';
    }
    return Math.round((this.elapsed() / this.duration()) * total).toLocaleString();
  });

  totalFramesLabel = computed(() => (this.session?.frameCount ?? 0).toLocaleString());

  healthCards = computed<HealthCard[]>(() => {
    const st = this.currentState();
    const get = (n: string) => st.get(n);

    const openDoors = DOOR_SIGNALS.filter(d => get(d) === 1).length;
    const trunkOpen = get('Bootlid_Status') === 1;
    const hoodOpen = get('Hood_Status') === 1;
    const openings = openDoors + (trunkOpen ? 1 : 0) + (hoodOpen ? 1 : 0);

    const validity = get('Steering_Validity');
    const eps = get('EPS_State');
    const steeringFault = validity === 0 || eps === 3;
    const steeringKnown = validity !== undefined || eps !== undefined;

    const wiper = get('Wiper_State');
    const wheelMax = Math.max(...WHEEL_SIGNALS.map(w => get(w) ?? 0));

    const keyZone = this.keyState();
    const keyMeta = keyZone ? KEY_ZONE_META[keyZone] : null;

    return [
      // No KEY POSITION card at all when the session carries no key data.
      ...(keyMeta ? [{
        label: 'KEY POSITION',
        value: keyMeta.label,
        color: keyMeta.color,
      }] : []),
      {
        label: 'DOORS',
        value: openings === 0 ? 'All closed' : `${openings} open`,
        color: openings === 0 ? COLOR_OK : COLOR_UNDECODED,
      },
      {
        label: 'STEERING SENSOR',
        value: !steeringKnown ? '—' : steeringFault ? 'Fault' : 'OK',
        color: !steeringKnown ? COLOR_MUTED : steeringFault ? COLOR_FAULT : COLOR_OK,
      },
      {
        label: 'WIPERS',
        value: wiper === undefined ? '—' : WIPER_LABELS[wiper] ?? String(wiper),
        color: wiper === undefined ? COLOR_MUTED : COLOR_OK,
      },
      {
        label: 'WHEEL SPEED',
        value: st.size === 0 ? '—' : WHEEL_LABELS[wheelMax] ?? String(wheelMax),
        color: st.size === 0 ? COLOR_MUTED : COLOR_OK,
      },
    ];
  });

  private unityInstance: UnityInstance | null = null;
  private loaderScriptEl: HTMLScriptElement | null = null;
  private canvasResizeObserver: ResizeObserver | null = null;
  private lastSentValue = new Map<string, number>();

  private replayBuffer: TimelinePoint[] = [];
  private points: TimelinePoint[] = [];
  private faults: IntegrityFault[] = [];
  private faultTimeline: { t: number; fault: IntegrityFault }[] = [];
  private origin = 0;
  private cursor = 0;
  private faultCursor = 0;
  /** Keys that have hit a fault at/behind the playhead — stay red until we scrub back. */
  private faultedKeys = new Set<string>();
  /** Working roster — mutated during ticks, committed to the signal per batch. */
  private rosterWork = new Map<string, RosterRow>();
  private replayEventsSub: Subscription | null = null;
  private replayTimer: ReturnType<typeof setInterval> | null = null;
  /** True once the user has actually pressed Play/scrubbed at least once — see
   *  resyncUnityState(). Never reset back to false (a finished replay keeps its
   *  last state; a paused replay keeps its current state either way). */
  private hasPlayedOnce = false;
  /** Per-signal value log for live sessions (replay reads this.points instead). */
  private liveHistory = new Map<string, HistoryEntry[]>();
  private liveStartMs = 0;

  constructor() {
    // Auto-scroll whichever table the most-recently-changed row lives in.
    effect(() => {
      const key = this.lastChangedKey();
      if (!key) return;
      requestAnimationFrame(() => {
        for (const ref of [this.logListRef, this.undecListRef]) {
          const list = ref?.nativeElement;
          const row = list?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
          if (list && row) {
            list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2);
            break;
          }
        }
      });
    });
  }

  /** Last zone pushed to Unity — dedups the SetKeyZone SendMessage spam from
   *  cyclic gear frames ('hidden' = key not shown). Reset on seek. */
  private lastSentKeyZone: KeyZone | 'hidden' | null = null;
  /** True once a direct KEY_Pos signal was seen — from then on the fob/gear
   *  inference is suppressed (the dedicated signal is authoritative). */
  private keyPosSeen = false;

  /** Moves the 3D key to a zone; KeyController answers with 'unity-keystate',
   *  which keeps the KEY POSITION card in sync automatically. */
  private sendKeyZone(zone: KeyZone): void {
    if (!this.unityInstance || this.lastSentKeyZone === zone) return;
    this.lastSentKeyZone = zone;
    try {
      this.unityInstance.SendMessage(KEY_ROOT_OBJECT, 'SetKeyZone', zone);
    } catch { /* older build without the key feature */ }
  }

  /** Hides the 3D key and the KEY POSITION card — no key data at/behind the
   *  playhead (or none in the whole session). */
  private sendKeyHidden(): void {
    this.keyState.set(null);
    if (!this.unityInstance || this.lastSentKeyZone === 'hidden') return;
    this.lastSentKeyZone = 'hidden';
    try {
      this.unityInstance.SendMessage(KEY_ROOT_OBJECT, 'SetKeyZone', 'hidden');
    } catch { /* older build without the key feature */ }
  }

  /** Bound once so removeEventListener in ngOnDestroy matches. */
  private readonly onKeyState = (e: Event) => {
    const zone = (e as CustomEvent<string>).detail;
    if (zone === 'inside' || zone === 'outside' || zone === 'unknown') {
      this.keyState.set(zone);
    }
  };

  ngAfterViewInit(): void {
    // Key-zone events from Unity's KeyController (KeyBridge.jslib) — registered
    // before Unity loads so the initial zone emitted on scene Start is caught.
    window.addEventListener('unity-keystate', this.onKeyState as EventListener);
    // Data path starts immediately, in parallel with the (slow) Unity download —
    // neither depends on the other. sendIfChanged() already no-ops the Unity
    // forwarding while unityInstance is null; resyncUnityState() catches Unity up
    // once it finishes loading.
    if (this.sessionId) {
      this.liveTelemetry.connectToSession(this.sessionId);
    }
    this.subscribeToLiveSignals();
    this.subscribeToLiveFrames();
    this.maybeStartReplay();
    this.loadUnity();
  }

  ngOnChanges(changes: SimpleChanges): void {
    // The session object loads async in the parent — if it wasn't there yet at
    // view init, start buffering as soon as it arrives.
    if (changes['session'] && !changes['session'].firstChange) {
      this.maybeStartReplay();
    }
    if (changes['seekTo'] && this.seekTo) {
      this.requestSeek(this.seekTo.t);
    }
  }

  /** Seek target waiting for the replay timeline to finish buffering. */
  private pendingSeekT: number | null = null;

  /**
   * Our own server playback id (REST start response). The playback topic is
   * shared with the charts view — a concurrent foreign stream's points and its
   * early 'complete' must be ignored or the roster/timeline loses signals.
   */
  private ownPlaybackId: string | null = null;

  /** True when the event belongs to a different concurrent playback stream. */
  private isForeignPlayback(pid: string | null | undefined): boolean {
    return !!pid && !!this.ownPlaybackId && pid !== this.ownPlaybackId;
  }

  /** External evidence link ("Twin @ t"): pause the replay at t. If the timeline
   *  isn't buffered yet, remember the target and apply it once it becomes active. */
  private requestSeek(t: number): void {
    if (this.replayState() === 'active') {
      this.hasPlayedOnce = true;
      this.playing.set(false);
      this.seek(t);
      this.freezeWheels();
    } else if (!this.isLive()) {
      this.pendingSeekT = t;
      this.maybeStartReplay();
    }
  }

  /** Buffer the completed session's timeline (no-op for live sessions / already started). */
  private maybeStartReplay(): void {
    const status = this.session?.status?.toUpperCase();
    if (this.session && status !== 'LIVE' && this.replayState() === 'idle') {
      this.startReplay();
    }
  }

  // ── Unity bootstrap ──────────────────────────────────────────────────────

  private async loadUnity(): Promise<void> {
    this.loadState.set('loading');
    try {
      await this.loadLoaderScript('/assets/car-twin/Build/car-twin-build.loader.js');

      this.unityInstance = await createUnityInstance(
        this.canvasRef.nativeElement,
        {
          dataUrl: '/assets/car-twin/Build/car-twin-build.data',
          frameworkUrl: '/assets/car-twin/Build/car-twin-build.framework.js',
          codeUrl: '/assets/car-twin/Build/car-twin-build.wasm',
          streamingAssetsUrl: '/assets/car-twin/StreamingAssets',
          companyName: 'DefaultCompany',
          productName: 'BMW_Digital_Twin',
          productVersion: '0.1',
        },
        (progress) => this.progressPct.set(Math.round(progress * 100)),
      );

      this.loadState.set('ready');
      // Unity locks its WebGL render buffer to the canvas size at load time and
      // only re-matches on a window 'resize'. If the stage grows after load
      // (layout change, window resize), nudge Unity to re-fit the taller canvas.
      this.observeCanvasResize();
      // The data path (started in ngAfterViewInit, in parallel) may already have
      // buffered and applied the session state — push the latest watched values
      // into the scene now that Unity can receive them.
      this.resyncUnityState();
      this.sendOrbitSpeed();
      this.sendFocusEnabled();
      // Ask KeyController to re-emit its current zone in case its initial
      // 'unity-keystate' fired before this listener could catch it. Builds
      // without KeyRoot just log a harmless "not found" warning.
      try {
        this.unityInstance.SendMessage(KEY_ROOT_OBJECT, 'RequestKeyState', '');
      } catch { /* older build without the key feature */ }
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err ?? 'Unknown error loading Unity build.'));
      this.loadState.set('error');
    }
  }

  /** Data may finish buffering before Unity loads — send the latest watched values.
   *  Gated on hasPlayedOnce for completed sessions: the idle "final value" preview
   *  populates currentState (for the signals table / health cards) without ever
   *  forwarding to Unity, so a late-loading Unity must not undo that by blindly
   *  resyncing to it — the car should stay parked until the user actually presses
   *  Play. Live sessions have no such preview step, so they always resync. */
  private resyncUnityState(): void {
    if (!this.isLive() && !this.hasPlayedOnce) return;
    this.currentState().forEach((value, name) => {
      if (WATCHED_SIGNALS.has(name)) this.sendIfChanged(name, value);
    });
  }

  private observeCanvasResize(): void {
    const canvas = this.canvasRef.nativeElement;
    let lastH = 0;
    let lastW = 0;
    this.canvasResizeObserver = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = canvas;
      // 0×0 means the tab is hidden (display:none), not a real resize — don't
      // make Unity collapse its render buffer.
      if (w === 0 || h === 0) return;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      // Unity's engine listens on window 'resize' to re-fit the drawing buffer.
      window.dispatchEvent(new Event('resize'));
    });
    this.canvasResizeObserver.observe(canvas);
  }

  private loadLoaderScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load Unity loader script at ${src}`));
      document.body.appendChild(script);
      this.loaderScriptEl = script;
    });
  }

  // ── Live mode ────────────────────────────────────────────────────────────

  private subscribeToLiveSignals(): void {
    this.liveTelemetry
      .getAllSignals$()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((signalMap: Map<string, DecodedSignal>) => {
        // While a replay is loaded, the replay transport owns the car + list.
        if (this.replayState() !== 'idle') return;

        let changedKey: string | null = null;
        for (const [name, sig] of signalMap) {
          const hasLabel = !!sig.label && sig.label !== 'N/A';
          // Enum-less numeric signals carry the decoder's raw:<n> fallback
          // label — show just the number instead of "raw:0 (0)".
          const display = hasEnumLabel(sig.label) ? `${sig.label} (${sig.raw_value})` : String(sig.raw_value);
          const existing = this.rosterWork.get(name);
          if (!existing || existing.display !== display) {
            this.rosterWork.set(name, {
              key: name,
              msgId: existing?.msgId ?? '',
              display,
              status: hasLabel ? 'ok' : 'undecoded',
            });
            this.recordLiveHistory(name, display, !hasLabel);
            changedKey = name;
          }
          this.forwardToTwin(name, sig.raw_value);
          const direct = keyZoneFromKeyPos(name, sig.raw_value);
          if (direct) {
            this.keyPosSeen = true;
            this.sendKeyZone(direct);
          } else if (!this.keyPosSeen) {
            const zone = keyZoneFromSignal(name, sig.raw_value);
            if (zone) this.sendKeyZone(zone);
          }
        }
        if (changedKey) {
          this.commitRoster();
          this.lastChangedKey.set(changedKey);
        }
      });
  }

  /** Live frames whose msg ID has no catalogue entry — surfaced as undecodable rows. */
  private subscribeToLiveFrames(): void {
    this.liveTelemetry.frames$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(frame => {
        if (this.replayState() !== 'idle') return;
        if ((frame.msgName ?? '').toUpperCase() !== 'UNKNOWN') return;
        const key = `${frame.msgId} (undecoded)`;
        if (this.rosterWork.has(key)) return;
        this.rosterWork.set(key, {
          key, msgId: frame.msgId ?? '', display: 'no catalogue entry', status: 'undecoded',
        });
        this.commitRoster();
        this.lastChangedKey.set(key);
      });
  }

  // ── Replay: buffering (same playback source as the charts view) ─────────

  private startReplay(): void {
    const s = this.session;
    if (!s || this.replayState() !== 'idle') return;

    this.replayState.set('buffering');
    this.replayBuffer = [];
    this.faults = [];
    this.keyPosSeen = false;
    this.ownPlaybackId = null;

    this.canService
      .getIntegrityFaults(s.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (faults) => { this.faults = faults; },
        error: () => { this.faults = []; },
      });

    this.liveTelemetry.subscribeToPlayback(s.sessionId);

    this.replayEventsSub = this.liveTelemetry.playback$.subscribe((event) => {
      if (event.type === 'point') {
        if (this.isForeignPlayback(event.playbackId)) return;
        const undecoded = (event.msgName ?? '').toUpperCase() === 'UNKNOWN';
        // Undecodable frames arrive with a null signalName (sanitized to 'N/A') —
        // key their row by msg ID instead.
        const name = undecoded
          ? `${event.msgId ?? '?'} (undecoded)`
          : (event.signalName ?? '');
        if (!name || name === 'N/A') return;
        this.replayBuffer.push({
          time: event.time,
          name,
          value: event.value ?? 0,
          label: event.label ?? 'N/A',
          msgId: event.msgId ?? '',
          undecoded,
          pid: event.playbackId ?? undefined,
        });
      } else if (event.type === 'complete') {
        if (this.isForeignPlayback(event.playbackId)) return;
        this.stopBuffering();
        this.prepareTimeline();
      } else if (event.type === 'error') {
        this.stopBuffering();
        this.replayState.set('idle');
      }
    });

    // Start the stream only once the STOMP subscription is live — events
    // published before it are dropped and the 30s safety net below fires.
    this.liveTelemetry.awaitConnected().then(() => this.canService
      .startPlayback({
        sessionId: s.sessionId,
        startTs: s.startTs,
        endTs: s.endTs,
        speed: 1,
        // No signal filter: the list shows every signal in the session.
        // Undecodable (unknown-catalogue) frames are opted into explicitly.
        includeUndecoded: true,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.ownPlaybackId = res.playbackId;
          // Purge points a concurrent foreign playback (e.g. the charts view's
          // buffering) slipped into the buffer before our own id was known.
          this.replayBuffer = this.replayBuffer.filter(
            (p) => !p.pid || p.pid === res.playbackId);
        },
        error: () => this.replayState.set('idle'),
      }));

    // Safety net: if the backend never sends 'complete', don't hang forever.
    setTimeout(() => {
      if (this.replayState() === 'buffering') {
        this.stopBuffering();
        if (this.replayBuffer.length > 0) this.prepareTimeline();
        else this.replayState.set('idle');
      }
    }, 30000);
  }

  private stopBuffering(): void {
    this.replayEventsSub?.unsubscribe();
    this.replayEventsSub = null;
    this.liveTelemetry.stopPlaybackSubscription();
  }

  private prepareTimeline(): void {
    if (this.replayBuffer.length === 0) {
      this.replayState.set('idle');
      return;
    }

    this.points = [...this.replayBuffer].sort((a, b) => a.time - b.time);
    this.origin = this.points[0].time;
    this.duration.set(Math.max(this.points[this.points.length - 1].time - this.origin, 0.1));

    this.faultTimeline = this.faults
      .map(f => ({ t: f.frameTimestamp - this.origin, fault: f }))
      .filter(ft => ft.t >= 0 && ft.t <= this.duration())
      .sort((a, b) => a.t - b.t);

    this.markers.set(
      this.faultTimeline.map(ft => ({
        pct: (ft.t / this.duration()) * 100,
        color: COLOR_FAULT,
      })),
    );

    this.replayState.set('active');
    this.playing.set(false);
    this.replayTimer = setInterval(() => this.tick(), TICK_MS);

    // Idle (not playing) populates the signals table / health cards with the
    // session's final state, but does NOT forward it to Unity — the car stays
    // parked (doors closed, wheels stopped, steering centered) until the user
    // actually presses Play, which rewinds to 0 via onPlayClick().
    this.seek(this.duration(), false);
    // The seek above only needed to walk the full timeline to populate the
    // roster — visually it left the scrubber/frame-counter/time-label parked
    // at the end, making a freshly-opened tab look like the replay already
    // finished. Reset just the playback-position bookkeeping back to 0 so the
    // replay bar looks untouched; the roster/health cards populated above are
    // untouched by this (no rebuild, no re-walk).
    this.resetPlaybackPosition();
    this.lastChangedKey.set(null);
    // An evidence link asked for "Twin @ t" before the timeline was buffered —
    // jump there now that the transport is active.
    if (this.pendingSeekT !== null) {
      const t = this.pendingSeekT;
      this.pendingSeekT = null;
      this.requestSeek(t);
    }
  }

  /** Resets elapsed/cursor/faultCursor/faultedKeys/lastSentValue to a fresh
   *  t=0 state without touching the roster — see prepareTimeline(). */
  private resetPlaybackPosition(): void {
    this.elapsed.set(0);
    this.cursor = 0;
    this.faultCursor = 0;
    this.faultedKeys.clear();
    this.lastSentValue.clear();
  }

  // ── Roster engine ────────────────────────────────────────────────────────

  /** One row per distinct signal so the list is fixed from the start. */
  private buildRosterBase(): void {
    this.rosterWork = new Map();
    for (const p of this.points) {
      if (!this.rosterWork.has(p.name)) {
        this.rosterWork.set(p.name, {
          key: p.name,
          msgId: p.msgId,
          display: '—',
          status: p.undecoded ? 'undecoded' : 'ok',
        });
      }
    }
  }

  private commitRoster(): void {
    this.roster.set(new Map(this.rosterWork));
  }

  /** Applies one point to the working roster (and Unity when forwarding). */
  private applyPoint(p: TimelinePoint, forwardToUnity: boolean): void {
    const undecoded = p.undecoded || p.label === 'N/A';
    // A faulted signal stays red even as its value keeps updating.
    const status: RowStatus = this.faultedKeys.has(p.name)
      ? 'fault'
      : undecoded ? 'undecoded' : 'ok';
    const display = p.undecoded
      ? 'raw frame'
      : hasEnumLabel(p.label) ? `${p.label} (${p.value})` : String(p.value);
    this.rosterWork.set(p.name, { key: p.name, msgId: p.msgId, display, status });
    if (forwardToUnity) {
      this.forwardToTwin(p.name, p.value);
      const direct = keyZoneFromKeyPos(p.name, p.value);
      if (direct) {
        this.keyPosSeen = true;
        this.sendKeyZone(direct);
      } else if (!this.keyPosSeen) {
        const zone = keyZoneFromSignal(p.name, p.value);
        if (zone) this.sendKeyZone(zone);
      }
    }
  }

  /**
   * Resolves which roster row a fault belongs to: the "Signal <name> …"
   * description first, then by msg ID. Null when nothing matches.
   */
  private faultKeyOf(fault: IntegrityFault): string | null {
    const m = /^Signal (\S+)/.exec(fault.description ?? '');
    if (m && this.rosterWork.has(m[1])) return m[1];
    if (fault.msgId) {
      for (const row of this.rosterWork.values()) {
        if (row.msgId === fault.msgId) return row.key;
      }
    }
    return null;
  }

  /** Marks a fault's row red (overflow row when unmatched). Returns the row key. */
  private applyFault(fault: IntegrityFault): string {
    let key = this.faultKeyOf(fault);

    if (!key) {
      key = OTHER_FAULTS_KEY;
      if (!this.rosterWork.has(key)) {
        this.rosterWork.set(key, { key, msgId: '', display: '—', status: 'fault' });
      }
    }

    this.faultedKeys.add(key);
    const row = this.rosterWork.get(key)!;
    this.rosterWork.set(key, {
      ...row,
      status: 'fault',
      faultType: fault.faultType,
      display: key === OTHER_FAULTS_KEY ? `${fault.faultType} — ${fault.msgName}` : row.display,
    });
    return key;
  }

  onRowClick(key: string): void {
    if (this.selectedSignalKey() === key) {
      this.selectedSignalKey.set(null);
      this.selectedHistory.set([]);
      return;
    }
    this.selectedSignalKey.set(key);
    this.selectedHistory.set(this.buildHistory(key));
  }

  /** Every value the signal went through: replay buffer first, live log otherwise. */
  private buildHistory(key: string): HistoryEntry[] {
    if (this.points.length > 0) {
      // Only the specific frame(s) where a fault was actually detected for this
      // signal are flagged — not every reading after it (that "latch red for the
      // rest of the replay" behavior belongs to the roster's live status pill,
      // not to a list of individual past values).
      const faultsForKey = this.faultTimeline.filter(ft => this.faultKeyOf(ft.fault) === key);
      const faultTypeAt = (t: number): FaultType | null => {
        const hit = faultsForKey.find(ft => Math.abs(ft.t - t) < 0.05);
        return hit ? hit.fault.faultType : null;
      };

      return this.points
        .filter(p => p.name === key)
        .map(p => {
          const t = p.time - this.origin;
          return {
            t,
            display: p.undecoded
              ? 'raw frame'
              : hasEnumLabel(p.label) ? `${p.label} (${p.value})` : String(p.value),
            undecoded: p.undecoded || p.label === 'N/A',
            faultType: faultTypeAt(t),
          };
        });
    }
    return [...(this.liveHistory.get(key) ?? [])];
  }

  private recordLiveHistory(name: string, display: string, undecoded: boolean): void {
    if (this.liveStartMs === 0) this.liveStartMs = Date.now();
    let entries = this.liveHistory.get(name);
    if (!entries) {
      entries = [];
      this.liveHistory.set(name, entries);
    }
    entries.push({ t: (Date.now() - this.liveStartMs) / 1000, display, undecoded, faultType: null });
    if (entries.length > LIVE_HISTORY_CAP) entries.shift();
  }

  statusLabel(status: RowStatus, faultType?: FaultType | null): string {
    switch (status) {
      case 'ok': return 'OK';
      case 'undecoded': return 'UNDEC';
      case 'fault': return this.faultTypeShortLabel(faultType);
    }
  }

  statusColor(status: RowStatus, faultType?: FaultType | null): string {
    switch (status) {
      case 'ok': return COLOR_OK;
      case 'undecoded': return COLOR_UNDECODED;
      case 'fault': return this.faultTypeColor(faultType);
    }
  }

  /** Per-fault-type color, matching the sniffer's Integrity tab palette. */
  faultTypeColor(type?: FaultType | null): string {
    return (type && FAULT_TYPE_COLORS[type]) || COLOR_FAULT;
  }

  faultTypeShortLabel(type?: FaultType | null): string {
    return (type && FAULT_TYPE_LABELS[type]) || 'FAULT';
  }

  /** Low-alpha tint of the fault-type color, for row/badge backgrounds. */
  faultBg(type?: FaultType | null): string {
    return `${this.faultTypeColor(type)}18`;
  }

  // ── Replay: transport ────────────────────────────────────────────────────

  private tick(): void {
    if (!this.playing()) return;

    const next = Math.min(this.elapsed() + (TICK_MS / 1000) * this.speed(), this.duration());
    this.elapsed.set(next);

    let changedKey: string | null = null;
    while (this.cursor < this.points.length && this.points[this.cursor].time - this.origin <= next) {
      const p = this.points[this.cursor++];
      this.applyPoint(p, true);
      changedKey = p.name;
    }
    while (this.faultCursor < this.faultTimeline.length && this.faultTimeline[this.faultCursor].t <= next) {
      changedKey = this.applyFault(this.faultTimeline[this.faultCursor++].fault);
    }
    if (changedKey) {
      this.commitRoster();
      this.lastChangedKey.set(changedKey);
    }

    if (next >= this.duration()) {
      this.playing.set(false);
      // Natural end of replay: reset the 3D car to the same parked state it
      // had before Play was ever pressed (doors closed, wheels stopped,
      // steering centered) — manually scrubbing to the end still shows the
      // session's real recorded end-state; this only applies when playback
      // actually runs to completion.
      this.parkCar();
    }
  }

  onPlayClick(): void {
    if (this.replayState() === 'idle') {
      this.startReplay();
      return;
    }
    if (this.replayState() !== 'active') return;
    if (!this.playing() && this.elapsed() >= this.duration()) this.seek(0);
    this.hasPlayedOnce = true;
    const willPlay = !this.playing();
    this.playing.set(willPlay);
    // Wheel spin is a continuous per-frame Unity animation, not a one-shot
    // value — pausing must explicitly zero it, and resuming must explicitly
    // re-push the real rate (see freezeWheels/resumeWheels).
    if (willPlay) this.resumeWheels(); else this.freezeWheels();
  }

  onSeekInput(event: Event): void {
    this.seek(parseFloat((event.target as HTMLInputElement).value) || 0);
    this.playing.set(false);
    this.hasPlayedOnce = true;
    this.freezeWheels();
  }

  /** Jump to time t: rebuilds the list (values + fault flags) as of t.
   *  forwardToUnity=false (used only for the initial idle preview) still
   *  updates currentState (signals table / health cards) but skips pushing
   *  ApplySignal to Unity — see prepareTimeline(). */
  seek(t: number, forwardToUnity = true): void {
    // Bulk-forwarding: only final values land in Unity — no event-focus swings
    // (neither from sendIfChanged-driven paths nor from the key-zone resend).
    this.focusSuppressed = true;
    try {
      this.seekInternal(t, forwardToUnity);
    } finally {
      this.focusSuppressed = false;
    }
  }

  private seekInternal(t: number, forwardToUnity: boolean): void {
    const clamped = Math.max(0, Math.min(t, this.duration()));
    this.elapsed.set(clamped);

    this.buildRosterBase();
    this.faultedKeys.clear();
    this.lastSentValue.clear();
    this.cursor = 0;
    this.faultCursor = 0;

    // Faults up to t are applied first so applyPoint keeps faulted rows red.
    while (this.faultCursor < this.faultTimeline.length && this.faultTimeline[this.faultCursor].t <= clamped) {
      this.applyFault(this.faultTimeline[this.faultCursor++].fault);
    }

    // Only the final watched value per signal is forwarded to Unity — replaying
    // every intermediate change into the 3D scene on a scrub would be wasteful.
    // Keyed by canonical twin channel with the value already normalized.
    const watchedAtT = new Map<string, number>();
    let lastKey: string | null = null;
    let keyZone: KeyZone | null = null;
    let directKeyZone: KeyZone | null = null;
    while (this.cursor < this.points.length && this.points[this.cursor].time - this.origin <= clamped) {
      const p = this.points[this.cursor++];
      this.applyPoint(p, false);
      const binding = this.resolveTwinBinding(p.name);
      if (binding) watchedAtT.set(binding.canonical, binding.convert(p.value));
      const direct = keyZoneFromKeyPos(p.name, p.value);
      if (direct) directKeyZone = direct;
      const z = keyZoneFromSignal(p.name, p.value);
      if (z) keyZone = z;
      lastKey = p.name;
    }

    watchedAtT.forEach((value, name) => this.sendIfChanged(name, value, forwardToUnity));
    if (forwardToUnity) {
      // KEY_Pos is authoritative when the session carries it; the fob/gear
      // inference only applies to sessions without it. No key value at/before
      // t → the key is hidden entirely. lastSentKeyZone is reset to force the
      // resend at the seek target.
      if (directKeyZone) this.keyPosSeen = true;
      const zone = directKeyZone ?? (this.keyPosSeen ? null : keyZone);
      this.lastSentKeyZone = null;
      if (zone) this.sendKeyZone(zone);
      else this.sendKeyHidden();
    }
    this.commitRoster();
    this.lastChangedKey.set(lastKey);
  }

  toggleSteering(): void {
    this.showSteering.update(v => !v);
    // Requires the Unity build with CanBridge.SetSteeringCam; older builds log
    // a harmless "method not found" warning in the browser console.
    this.unityInstance?.SendMessage(CAR_ROOT_OBJECT, 'SetSteeringCam', this.showSteering() ? '1' : '0');
  }

  onOrbitSpeedInput(event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    const value = Math.max(0, Math.min(ORBIT_SPEED_MAX, Number.isFinite(raw) ? Math.round(raw) : ORBIT_SPEED_DEFAULT));
    this.orbitSpeed.set(value);
    this.sendOrbitSpeed();
  }

  /** Pushes the slider value into Unity — also called once on Unity load so a
   *  value picked while the build was still downloading is applied. */
  private sendOrbitSpeed(): void {
    try {
      this.unityInstance?.SendMessage(CAR_ROOT_OBJECT, 'SetOrbitSpeed', String(this.orbitSpeed()));
    } catch { /* older build without the camera feature */ }
  }

  toggleFocus(): void {
    this.focusEnabled.update(v => !v);
    this.sendFocusEnabled();
  }

  /** Mirrors the toggle into Unity — disabling also eases an in-flight focus
   *  back into the orbit. Pushed once on Unity load like the orbit speed. */
  private sendFocusEnabled(): void {
    try {
      this.unityInstance?.SendMessage(CAR_ROOT_OBJECT, 'SetEventFocus', this.focusEnabled() ? '1' : '0');
    } catch { /* older build without the camera feature */ }
  }

  fmtTime(t: number): string {
    const m = Math.floor(t / 60);
    const s = (t % 60).toFixed(2);
    return `${m}:${s.padStart(5, '0')}`;
  }

  // ── Shared ───────────────────────────────────────────────────────────────

  /** Wheel spin is a continuous per-frame rotation in Unity — CarController.
   *  AnimateWheels() keeps rotating every frame at whatever rate was last
   *  sent, independent of our own tick timer. Pausing/scrubbing must
   *  explicitly zero it or the wheels spin forever. Doesn't touch
   *  currentState — the signals table / health card should still show the
   *  real recorded value, only the 3D animation freezes. */
  private freezeWheels(): void {
    if (!this.unityInstance) return;
    for (const name of WHEEL_SIGNALS) {
      if (this.lastSentValue.get(name) === 0) continue;
      this.lastSentValue.set(name, 0);
      this.unityInstance.SendMessage(CAR_ROOT_OBJECT, 'ApplySignal', `${name}:0`);
    }
  }

  /** Resume from pause: re-push the real current wheel speed — freezeWheels()
   *  zeroed Unity's copy without touching currentState, so sendIfChanged's
   *  own dedup would otherwise think nothing changed and skip resending. */
  private resumeWheels(): void {
    const state = this.currentState();
    for (const name of WHEEL_SIGNALS) {
      const value = state.get(name);
      if (value !== undefined) this.sendIfChanged(name, value);
    }
  }

  /** Resets the 3D car to the same parked state it had before Play was ever
   *  pressed — doors/trunk closed, wipers off, steering centered, wheels
   *  stopped (every WATCHED_SIGNALS case in CanBridge treats 0 as the "off"
   *  state). Only touches Unity + the forward-dedup cache, not currentState
   *  — the signals table / health cards keep showing the session's real
   *  recorded end values. */
  private parkCar(): void {
    if (!this.unityInstance) return;
    for (const name of WATCHED_SIGNALS) {
      if (this.lastSentValue.get(name) === 0) continue;
      this.lastSentValue.set(name, 0);
      this.unityInstance.SendMessage(CAR_ROOT_OBJECT, 'ApplySignal', `${name}:0`);
    }
    // Key back to its pre-play default: hidden until signals place it again.
    this.sendKeyHidden();
  }

  /** Lazily resolved (and cached) binding per raw signal name — null when the
   *  signal maps to no twin channel. */
  private twinBindingCache = new Map<string, TwinBinding | null>();

  private resolveTwinBinding(name: string): TwinBinding | null {
    let binding = this.twinBindingCache.get(name);
    if (binding === undefined) {
      binding = TWIN_BINDINGS.find(t => t.canonical === name || t.match.test(name)) ?? null;
      this.twinBindingCache.set(name, binding);
    }
    return binding;
  }

  /** Dynamic forwarding: resolve the catalogue's signal name to its canonical
   *  twin channel, normalize the value, and send. No-op for unmapped signals.
   *  A value that actually changed AND was forwarded also swings the showroom
   *  camera onto the part that just animated (event focus). This is the only
   *  ApplySignal path that focuses — seek/scrub bulk-forwarding, the post-load
   *  resync, resumeWheels and parkCar all bypass forwardToTwin on purpose. */
  private forwardToTwin(name: string, raw: number, forwardToUnity = true): void {
    const binding = this.resolveTwinBinding(name);
    if (!binding) return;
    const sent = this.sendIfChanged(binding.canonical, binding.convert(raw), forwardToUnity);
    if (sent) {
      const part = FOCUS_PARTS[binding.canonical];
      if (part) this.sendFocus(part);
    }
  }

  /** True while seek() bulk-forwards state — the camera must not chase every
   *  intermediate value of a scrub. */
  private focusSuppressed = false;

  /** Event focus: ask the showroom camera to swing onto a part (CanBridge.FocusPart). */
  private sendFocus(part: string): void {
    if (!this.focusEnabled() || this.focusSuppressed || !this.unityInstance) return;
    try {
      this.unityInstance.SendMessage(CAR_ROOT_OBJECT, 'FocusPart', part);
    } catch { /* older build without the camera feature */ }
  }

  /** currentState always updates (drives the signals table + health cards).
   *  forwardToUnity=false skips the actual SendMessage — used for the idle
   *  "final value" preview so the 3D car stays parked until Play is pressed.
   *  Returns true only when the value was actually sent to Unity (changed +
   *  forwarding enabled + Unity loaded) — the event-focus trigger keys off it. */
  private sendIfChanged(name: string, value: number, forwardToUnity = true): boolean {
    this.currentState.update(map => {
      if (map.get(name) === value) return map;
      const next = new Map(map);
      next.set(name, value);
      return next;
    });

    if (!forwardToUnity || !this.unityInstance) return false;
    if (this.lastSentValue.get(name) === value) return false;
    this.lastSentValue.set(name, value);
    this.unityInstance.SendMessage(CAR_ROOT_OBJECT, 'ApplySignal', `${name}:${value}`);
    return true;
  }

  // ── Fault-report export ────────────────────────────────────────────────────

  /**
   * Captures the current 3D viewport and prints the SAME unified full-report
   * composition as the Report tab's Download PDF — the snapshot image is the
   * only Twin-specific addition. Every part degrades independently: a missing
   * snapshot, summary or full report still produces a PDF.
   */
  async exportReport(): Promise<void> {
    if (this.exporting() || this.loadState() !== 'ready') return;
    this.exporting.set(true);
    try {
      // Move the 3D car to its final recorded pose first, so the embedded image
      // is the end-of-session state (not wherever playback happened to be paused).
      await this.seekToFinalState();
      const [snapshotDataUrl, fullReport] = await Promise.all([
        this.captureSnapshot(),
        this.fetchFullReport(),
      ]);
      // The unified report embeds the summary; generate one on the fly only
      // when neither exists yet (mirrors the Report tab's Generate flow).
      let summary = fullReport?.summary ?? null;
      if (!summary) summary = await this.ensureSummary();
      // Diagnostics come from the composition; fall back to the standalone
      // endpoint, then to the flat faults table, if pieces are missing.
      const report = fullReport?.diagnostics ?? await this.fetchReport();
      const faults = report
        ? this.toFaultRows(report.subsystems.flatMap((s) => s.faults))
        : await this.fetchAllFaults();
      await this.faultReport.download({
        sessionId: this.sessionId,
        sessionName: this.session?.sourceFilename ?? this.sessionId,
        vehicle: fullReport?.vehicle ?? undefined,
        summary,
        snapshotDataUrl,
        signals: this.collectSignals(),
        faults,
        report,
        vehicleState: fullReport?.vehicleState?.length
          ? fullReport.vehicleState
          : report ? this.pickVehicleState(report) : undefined,
        verdict: fullReport?.overallVerdict ?? null,
        specFaultCount: fullReport?.specFaultCount,
        requirementViolationCount: fullReport?.requirementViolationCount,
        requirements: fullReport?.requirements ?? null,
        clusters: fullReport?.clusters ?? [],
        provenance: FaultReportService.provenanceLabel(summary),
        trendLabel: FaultReportService.trendLabel(summary?.healthScore, fullReport?.history),
      });
    } catch (err) {
      // The global HTTP interceptor already toasts network failures; log PDF/canvas
      // failures so a broken export is diagnosable instead of silently doing nothing.
      console.error('Fault-report export failed', err);
    } finally {
      this.exporting.set(false);
    }
  }

  /**
   * Asks Unity (via CanBridge.CaptureSnapshot → SnapshotBridge.jslib) for a PNG
   * of the current frame, delivered back as base64 on a 'unity-snapshot' window
   * event. Resolves null (PDF then omits the image) if Unity isn't ready, the
   * build predates the CaptureSnapshot method, or nothing arrives in time.
   */
  captureSnapshot(timeoutMs = 5000): Promise<string | null> {
    if (!this.unityInstance || this.loadState() !== 'ready') return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (v: string | null) => {
        if (settled) return;
        settled = true;
        window.removeEventListener('unity-snapshot', onSnap as EventListener);
        resolve(v);
      };
      const onSnap = (e: Event) => {
        const b64 = (e as CustomEvent<string>).detail;
        finish(b64 ? `data:image/png;base64,${b64}` : null);
      };
      window.addEventListener('unity-snapshot', onSnap as EventListener);
      try {
        this.unityInstance!.SendMessage(CAR_ROOT_OBJECT, 'CaptureSnapshot', '');
      } catch {
        finish(null);
        return;
      }
      setTimeout(() => finish(null), timeoutMs);
    });
  }

  /**
   * Returns the AI diagnostic summary, generating it first if none exists yet
   * (POST /summary/generate, then poll until it lands — mirrors the Report tab).
   * Guarantees the exported PDF always carries the plain-English narrative, fault
   * explanation and recommendations, not just the static tables.
   */
  private async ensureSummary(): Promise<SessionSummary | null> {
    if (!this.sessionId) return null;
    const existing = await firstValueFrom(
      this.summaryService.getQuiet(this.sessionId).pipe(catchError(() => of(null))),
    );
    if (existing) return existing;

    // None yet — trigger generation, then poll (~24s max) until it's ready.
    await firstValueFrom(
      this.summaryService.generate(this.sessionId).pipe(catchError(() => of(void 0))),
    );
    return firstValueFrom(
      interval(2000).pipe(
        take(12),
        switchMap(() => this.summaryService.getQuiet(this.sessionId).pipe(catchError(() => of(null)))),
        filter((s): s is SessionSummary => s !== null),
        take(1),
        defaultIfEmpty(null),
      ),
    );
  }

  /**
   * Seeks the replay to its end and pushes the final recorded values into Unity,
   * so a subsequent snapshot shows the car's end-of-session state rather than the
   * current paused frame. No-op for live sessions (nothing to seek — the live
   * feed is already the latest state).
   */
  private async seekToFinalState(): Promise<void> {
    if (this.replayState() !== 'active' || this.duration() <= 0) return;
    this.playing.set(false);
    this.hasPlayedOnce = true;
    this.seek(this.duration(), true);
    // Let Unity render the final pose over a few frames before the screenshot.
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }

  /** Flattens both roster tables into report rows (catalogued first, then undecoded). */
  private collectSignals(): ReportSignalRow[] {
    return [...this.rosterRows(), ...this.undecodedRows()].map((r) => ({
      name: r.key,
      value: r.display,
      status: this.statusLabel(r.status, r.faultType),
    }));
  }

  /**
   * ALL integrity faults for the session, fetched fresh from the backend at
   * export time — not the playhead-dependent `this.faults` snapshot (which is
   * empty for live sessions and only reflects a loaded replay). This guarantees
   * the report lists every fault regardless of where playback is paused.
   */
  private fetchAllFaults(): Promise<ReportFaultRow[]> {
    if (!this.sessionId) return Promise.resolve([]);
    return firstValueFrom(
      this.canService.getIntegrityFaults(this.sessionId).pipe(catchError(() => of<IntegrityFault[]>([]))),
    ).then((faults) => this.toFaultRows(faults));
  }

  /** The unified full report; resolves null so the export degrades gracefully. */
  private fetchFullReport(): Promise<FullReport | null> {
    if (!this.sessionId) return Promise.resolve(null);
    return firstValueFrom(
      this.canService.getFullReport(this.sessionId).pipe(catchError(() => of<FullReport | null>(null))),
    );
  }

  /**
   * The subsystem-grouped diagnostic report (enriched faults + two verdicts). One call
   * that also back-fills per-fault context; resolves null so the export degrades to the
   * legacy flat faults table if the endpoint fails.
   */
  private fetchReport(): Promise<DiagnosticReport | null> {
    if (!this.sessionId) return Promise.resolve(null);
    return firstValueFrom(
      this.canService.getDiagnosticReport(this.sessionId).pipe(catchError(() => of<DiagnosticReport | null>(null))),
    );
  }

  /**
   * The vehicle operating-state shown in the report's top Vehicle State bar — taken from
   * the most-severe fault's context (subsystems are already ordered worst-first).
   */
  private pickVehicleState(report: DiagnosticReport): FaultContextSignal[] | undefined {
    for (const sub of report.subsystems) {
      for (const f of sub.faults) {
        if (f.context?.length) return f.context;
      }
    }
    return undefined;
  }

  /** Maps faults to report rows, sorted by time, with times relative to the first fault. */
  private toFaultRows(faults: IntegrityFault[]): ReportFaultRow[] {
    if (faults.length === 0) return [];
    // Prefer the replay origin when known; otherwise anchor to the earliest fault
    // so the "TIME" column still reads as a sensible +M:SS offset.
    const origin = this.origin > 0 ? this.origin : Math.min(...faults.map((f) => f.frameTimestamp));
    return [...faults]
      .sort((a, b) => a.frameTimestamp - b.frameTimestamp)
      .map((f) => ({
        type: this.faultTypeShortLabel(f.faultType),
        message: f.description ?? '',
        msgName: f.msgName ?? undefined,
        time: `+${this.fmtTime(Math.max(0, f.frameTimestamp - origin))}`,
      }));
  }

  ngOnDestroy(): void {
    window.removeEventListener('unity-keystate', this.onKeyState as EventListener);
    if (this.replayTimer !== null) {
      clearInterval(this.replayTimer);
      this.replayTimer = null;
    }
    this.stopBuffering();
    this.canvasResizeObserver?.disconnect();
    this.canvasResizeObserver = null;
    this.unityInstance?.Quit();
    this.unityInstance = null;
    this.loaderScriptEl?.remove();
  }
}
