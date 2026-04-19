import Swal, { SweetAlertOptions } from 'sweetalert2';

const BASE: SweetAlertOptions = {
  background: '#0a0d0a',
  color: '#c0d0b0',
  confirmButtonColor: '#b0ff44',
  cancelButtonColor: '#1c2a1c',
  customClass: {
    confirmButton: 'swal-confirm-btn',
    cancelButton:  'swal-cancel-btn',
  },
};

export const swal = {
  error(title: string, text: string) {
    return Swal.fire({ ...BASE, icon: 'error', title, text });
  },

  success(title: string, text?: string) {
    return Swal.fire({ ...BASE, icon: 'success', title, ...(text ? { text } : {}) });
  },

  confirm(title: string, text: string) {
    return Swal.fire({
      ...BASE,
      icon: 'question',
      title,
      text,
      showCancelButton: true,
      confirmButtonText: 'Confirm',
      cancelButtonText:  'Cancel',
    });
  },
};

/** Returns true when the server error indicates a duplicate username/email. */
export function isDuplicate(err: any): boolean {
  const msg = (err?.error?.message ?? '').toLowerCase();
  return (
    err?.status === 409 ||
    msg.includes('already') ||
    msg.includes('duplicate') ||
    msg.includes('in use') ||
    msg.includes('exists')
  );
}

/** Human-readable duplicate message that names the offending field. */
export function duplicateText(err: any): string {
  const msg = (err?.error?.message ?? '').toLowerCase();
  if (msg.includes('username')) return 'That username is already in use. Please choose a different one.';
  if (msg.includes('email'))    return 'That email address is already registered. Please use a different one.';
  return err?.error?.message ?? 'This username or email is already in use.';
}
