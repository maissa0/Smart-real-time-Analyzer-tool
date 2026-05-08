import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  ViewChildren,
  QueryList,
  ElementRef,
  AfterViewInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

@Component({
  selector: 'app-code-verification',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './code-verification.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeVerificationComponent implements AfterViewInit {
  private readonly router = inject(Router);

  @ViewChildren('digitInput') digitInputs!: QueryList<ElementRef<HTMLInputElement>>;

  readonly digits = signal<string[]>(['', '', '', '']);
  readonly verifying = signal(false);

  ngAfterViewInit(): void {
    setTimeout(() => this.digitInputs?.first?.nativeElement?.focus(), 0);
  }

  onDigitInput(index: number, event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = input.value.replace(/\D/g, '').slice(-1);
    this.digits.update((d) => {
      const next = [...d];
      next[index] = value;
      return next;
    });
    if (value && index < 3) {
      this.digitInputs?.get(index + 1)?.nativeElement?.focus();
    }
  }

  onDigitKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.digits()[index] && index > 0) {
      this.digitInputs?.get(index - 1)?.nativeElement?.focus();
    }
  }

  onPaste(event: ClipboardEvent): void {
    const pasted = event.clipboardData?.getData('text').replace(/\D/g, '').slice(0, 4).split('') ?? [];
    this.digits.update((d) => {
      const next = [...d];
      pasted.forEach((v, i) => (next[i] = v));
      return next;
    });
    if (pasted.length > 0) {
      this.digitInputs?.get(Math.min(pasted.length, 3))?.nativeElement?.focus();
    }
    event.preventDefault();
  }

  getCode(): string {
    return this.digits().join('');
  }

  onSubmit(): void {
    if (this.getCode().length === 4) {
      this.verifying.set(true);
      setTimeout(() => {
        this.router.navigateByUrl('/auth/reset-password');
      }, 500);
    }
  }
}
