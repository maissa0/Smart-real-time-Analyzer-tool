export interface CanSession {
  id: number;
  sessionId: string;
  sourceFilename: string;
  startTs: number;
  endTs: number;
  frameCount: number;
  createdAt: string;
  status?: string | null;
}

export interface DecodedSignal {
  signal_name: string;
  raw_value: number;
  label: string;
}

export interface CanFrame {
  id: number;
  sessionId: string;
  timestamp: number;
  channel: number;
  channelName: string;
  msgId: string;
  msgName: string;
  direction: string;
  rawBytes: string;
  signals: string;
}

export function parseSignals(signalsJson: string): DecodedSignal[] {
  try {
    return JSON.parse(signalsJson);
  } catch {
    return [];
  }
}

export interface IntegrityFault {
  id: number;
  sessionId: string;
  frameId: number | null;
  msgId: string;
  msgName: string;
  faultType: 'DUPLICATE' | 'TIMING_GAP' | 'SIGNAL_RANGE';
  description: string;
  frameTimestamp: number;
  createdAt: string;
}

export interface IntegritySummary {
  totalFaults: number;
  duplicates: number;
  timingGaps: number;
  signalRangeViolations: number;
  affectedMsgIds: string[];
  healthy: boolean;
}
