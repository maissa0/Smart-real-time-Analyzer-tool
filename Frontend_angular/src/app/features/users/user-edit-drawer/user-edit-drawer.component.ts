import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
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
  private readonly fb          = inject(FormBuilder);
  private readonly userService = inject(UserService);

  user   = input.required<User>();
  closed = output<void>();
  saved  = output<User>();

  readonly isSaving = signal(false);

  // Only jobTitle and department are editable by admin
  readonly form = this.fb.nonNullable.group({
    jobTitle:   [''],
    department: [''],
  });

  constructor() {
    effect(() => {
      const u = this.user();
      this.form.patchValue({
        jobTitle:   u.jobTitle   ?? '',
        department: u.department ?? '',
      });
    });
  }

  onClose(): void { this.closed.emit(); }

  onSubmit(): void {
    if (this.form.invalid) return;
    const { jobTitle, department } = this.form.getRawValue();
    const userId = this.user().id;
    this.isSaving.set(true);
    this.userService.updateUser(userId, { jobTitle, department }).subscribe({
      next: (updated) => {
        this.isSaving.set(false);
        this.saved.emit(updated);
      },
      error: () => { this.isSaving.set(false); },
    });
  }
}
