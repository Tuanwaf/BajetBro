import { writable } from 'svelte/store';

export const toastMessage = writable('');
export const toastVisible = writable(false);

let hideTimer;

export function showToast(msg) {
  clearTimeout(hideTimer);
  toastMessage.set(msg);
  toastVisible.set(true);
  hideTimer = setTimeout(() => toastVisible.set(false), 2000);
}
