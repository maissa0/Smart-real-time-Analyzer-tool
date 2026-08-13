import { Injectable } from '@angular/core';
import { CanSession } from '../models/can.model';

@Injectable({ providedIn: 'root' })
export class SessionStateService {

  /** True when the session is a live simulation that has not yet completed. */
  isLive(session: CanSession): boolean {
    return (
      session.sourceFilename === 'live_simulation' &&
      session.status !== 'COMPLETE' &&
      (session.status == null || session.status === '' || session.status === 'LIVE')
    );
  }

  /** True when the session originated from a live simulation (regardless of completion). */
  isLiveSource(session: CanSession): boolean {
    return session.sourceFilename === 'live_simulation';
  }

  /** Live sessions first, then newest-first by createdAt. Returns a new sorted array. */
  sortByLiveThenDate(sessions: CanSession[]): CanSession[] {
    return [...sessions].sort((a, b) => {
      const aLive = this.isLiveSource(a) ? 1 : 0;
      const bLive = this.isLiveSource(b) ? 1 : 0;
      if (aLive !== bLive) return bLive - aLive;
      const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return dateB - dateA;
    });
  }
}
