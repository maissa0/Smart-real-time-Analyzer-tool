import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NlAskComponent } from './nl-ask.component';

/**
 * Global "ask your data" palette: opens with Ctrl+K (or the navbar ✨ button),
 * closes with Escape or a backdrop click. Wraps the reusable NlAskComponent so
 * natural-language questions work from any page of the app.
 */
@Component({
  selector: 'app-nl-palette',
  standalone: true,
  imports: [CommonModule, NlAskComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [`
    .backdrop {
      position: fixed; inset: 0; z-index: 80; background: rgba(0,0,0,0.6);
      backdrop-filter: blur(3px); display: flex; justify-content: center;
      align-items: flex-start; padding-top: 12vh;
    }
    .panel {
      width: min(760px, 92vw); background: #0d1117;
      border: 1px solid rgba(176,255,68,0.25); border-radius: 14px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6); padding: 1rem 1.1rem 1.1rem;
      animation: pal-in 0.15s ease-out;
    }
    @keyframes pal-in { from { transform: translateY(-10px); opacity: 0; } to { transform: none; opacity: 1; } }
    .head { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.7rem; }
    .title { flex: 1; font-size: 0.85rem; font-weight: 700; color: #e6edf3; }
    .kbd {
      font-size: 0.6rem; color: #8a9ab0; border: 1px solid #30363d; border-radius: 4px;
      padding: 1px 6px; font-family: ui-monospace, Menlo, monospace;
    }
    .hints { margin: 0.7rem 0 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 0.4rem; }
    .hints li {
      font-size: 0.66rem; color: #8a9ab0; background: rgba(72,79,88,0.2);
      border-radius: 10px; padding: 3px 9px; cursor: default;
    }
  `],
  template: `
    @if (open()) {
      <div class="backdrop" (click)="open.set(false)">
        <div class="panel" (click)="$event.stopPropagation()">
          <div class="head">
            <span class="title">✨ Ask your data</span>
            <span class="kbd">Ctrl+K</span>
            <span class="kbd">Esc to close</span>
          </div>
          <app-nl-ask placeholder="e.g. 'how many faults of each type are there?' or 'which car has the most sessions?'" />
          <ul class="hints">
            <li>“list all sessions with their duration”</li>
            <li>“fault breakdown by type”</li>
            <li>“which cars have sessions and how many?”</li>
            <li>“show duplicate faults for session …”</li>
          </ul>
        </div>
      </div>
    }
  `,
})
export class NlPaletteComponent {
  readonly open = signal(false);

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.open.update((v) => !v);
    } else if (event.key === 'Escape' && this.open()) {
      this.open.set(false);
    }
  }
}
