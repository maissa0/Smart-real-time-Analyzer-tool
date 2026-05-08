import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  inject,
  effect,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import type { User } from '../../../data/models';
import { UserService } from '../../../core/services/user.service';

@Component({
  selector: 'app-user-edit-drawer',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './user-edit-drawer.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserEditDrawerComponent {
  private readonly fb = inject(FormBuilder);
  private readonly userService = inject(UserService);

  user = input.required<User>();
  closed = output<void>();
  saved = output<User>();

  readonly isSaving = signal(false);
  readonly form = this.fb.nonNullable.group({
    fullName: ['', [Validators.required, Validators.minLength(2)]],
    jobTitle: [''],
    department: [''],
    timezone: [''],
    phone: [''],
    bio: [''],
  });

  constructor() {
    effect(() => {
      const u = this.user();
      this.form.patchValue({
        fullName: u.fullName ?? '',
        jobTitle: u.jobTitle ?? '',
        department: u.department ?? '',
        timezone: u.timezone ?? '',
        phone: u.phone ?? '',
        bio: u.bio ?? '',
      });
    });
  }

  onClose(): void {
    this.closed.emit();
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { fullName, jobTitle, department, timezone, phone, bio } = this.form.getRawValue();
    const userId = this.user().id;
    this.isSaving.set(true);
    this.userService.updateUser(userId, { fullName, jobTitle, department, timezone, phone, bio }).subscribe({
      next: (updated) => {
        this.isSaving.set(false);
        this.saved.emit(updated);
      },
      error: () => {
        this.isSaving.set(false);
      },
    });
  }
}
