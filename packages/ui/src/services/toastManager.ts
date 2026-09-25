import type { ReactNode } from 'react';
import { toast } from 'sonner';

export const TOAST_TIMEOUT = 5000;

export type ToastType = 'success' | 'error' | 'loading' | 'info' | 'warning' | 'default';

export interface ToastOptions {
  type?: ToastType | (string & {});
  title?: ReactNode;
  description?: ReactNode;
  /** Milliseconds before it closes on its own; `0` keeps it until closed. */
  timeout?: number;
}

const current = new Map<string, ToastOptions>();
let counter = 0;

function show(id: string, options: ToastOptions) {
  const { type = 'default', title, description, timeout } = options;
  const duration = timeout === 0 ? Infinity : (timeout ?? TOAST_TIMEOUT);
  const data = {
    id,
    description,
    duration,
    onDismiss: () => current.delete(id),
    onAutoClose: () => current.delete(id),
  };

  switch (type) {
    case 'success':
      return toast.success(title, data);
    case 'error':
      return toast.error(title, data);
    case 'loading':
      return toast.loading(title, data);
    case 'info':
      return toast.info(title, data);
    case 'warning':
      return toast.warning(title, data);
    default:
      return toast(title, data);
  }
}

/**
 * Imperative toast API, callable outside React (Api, action helpers). Backed by sonner; the
 * `<Toaster />` in the app shell renders whatever is raised here.
 */
export const toastManager = {
  add(options: ToastOptions): string {
    const id = `toast-${++counter}`;
    current.set(id, options);
    show(id, options);
    return id;
  },

  /**
   * Shows a toast under a fixed id, unless one with that id is still on screen. For a failure
   * that polling would otherwise repeat every interval.
   */
  addOnce(id: string, options: ToastOptions): string {
    if (!current.has(id)) {
      current.set(id, options);
      show(id, options);
    }
    return id;
  },

  /** Merges into a live toast, e.g. turning a loading toast into its success message. */
  update(id: string, options: ToastOptions) {
    const merged = { ...current.get(id), ...options };
    if (options.timeout === undefined && current.get(id)?.timeout === 0) {
      // A pending toast is held open with `timeout: 0`; its outcome should close normally.
      merged.timeout = undefined;
    }
    current.set(id, merged);
    show(id, merged);
  },

  close(id: string) {
    current.delete(id);
    toast.dismiss(id);
  },
};
