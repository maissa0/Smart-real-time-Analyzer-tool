import { Component } from '@angular/core';

@Component({
  selector: 'app-users',
  standalone: true,
  template: `
    <section class="placeholder">
      <h1>Users</h1>
      <p>Protected route — content in a later step.</p>
    </section>
  `,
  styles: [
    `
      .placeholder {
        padding: 1.5rem;
        font-family: system-ui, sans-serif;
      }
    `,
  ],
})
export class UsersComponent {}
