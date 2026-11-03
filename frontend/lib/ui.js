import { reactive } from 'vue';

// ---- Toasts ----
export const toasts = reactive([]);
let toastSeq = 0;

/** Show a toast. `action` adds a button: { label, run } (e.g. Undo). */
export function toast(message, type = 'info', timeout = 3200, action = null) {
  const id = ++toastSeq;
  toasts.push({ id, message, type, timeout, action });
  if (toasts.length > 5) toasts.splice(0, toasts.length - 5);
  if (timeout) setTimeout(() => dismissToast(id), timeout);
  return id;
}
toast.error = (m) => toast(m, 'error', 5000);
toast.success = (m) => toast(m, 'success');
/** "Moved to trash" with an Undo button */
toast.undo = (m, undo, label = 'Undo') => toast(m, 'success', 6500, { label, run: undo });

export function dismissToast(id) {
  const i = toasts.findIndex(t => t.id === id);
  if (i !== -1) toasts.splice(i, 1);
}

// ---- Dialogs (replace window.alert / confirm / prompt) ----
export const dialog = reactive({ open: false, kind: 'confirm', title: '', message: '', value: '', placeholder: '', confirmText: 'OK', cancelText: 'Cancel', danger: false, inputType: 'text', resolve: null });

function openDialog(opts) {
  if (dialog.resolve) dialog.resolve(dialog.kind === 'prompt' ? null : false);
  return new Promise((resolve) => {
    Object.assign(dialog, {
      title: '', message: '', value: '', placeholder: '', confirmText: 'OK', cancelText: 'Cancel', danger: false, inputType: 'text',
      ...opts, open: true, resolve,
    });
  });
}

export const confirmDialog = (opts) => openDialog({ kind: 'confirm', confirmText: 'Confirm', ...opts });
export const promptDialog = (opts) => openDialog({ kind: 'prompt', confirmText: 'Save', ...opts });

export function closeDialog(result) {
  const r = dialog.resolve;
  dialog.open = false;
  dialog.resolve = null;
  if (r) r(result);
}

/** Run an async action and surface its error as a toast. Returns the result or undefined. */
export async function attempt(fn, successMessage) {
  try {
    const r = await fn();
    if (successMessage) toast.success(successMessage);
    return r;
  } catch (e) {
    toast.error(e.message || 'Something went wrong');
    return undefined;
  }
}
