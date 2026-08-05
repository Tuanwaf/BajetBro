import { writable, get } from 'svelte/store';

const DISMISS_KEY = 'bb-install-dismissed';

// { visible, platform: 'android'|'ios'|null }. Single source of truth so
// InstallBanner.svelte just renders whatever this says, instead of running
// its own duplicate detection.
export const installBannerState = writable({ visible: false, platform: null });

let deferredPrompt = null;
let initialized = false;
let waiters = [];

export function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function alreadyResolved() {
  return isStandalone() || !!localStorage.getItem(DISMISS_KEY);
}

function settle() {
  const fns = waiters;
  waiters = [];
  fns.forEach((fn) => fn());
}

// Attaches the beforeinstallprompt listener as early as possible (called
// from main.js before the app even mounts) and, on iOS, flags the banner
// immediately since there's no event to wait for there. If neither signal
// shows up within the grace period below, resolves anyway so onboarding
// (the guided tour) isn't blocked forever on a prompt that will never come
// -- desktop Chrome, Firefox, unsupported browsers, etc.
export function initInstallPrompt() {
  if (initialized || alreadyResolved()) return;
  initialized = true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBannerState.set({ visible: true, platform: 'android' });
  });

  if (isIOS()) {
    installBannerState.set({ visible: true, platform: 'ios' });
  }

  setTimeout(() => {
    if (!get(installBannerState).visible) settle();
  }, 1500);
}

// Resolves once the install prompt has either been shown-and-dealt-with, or
// was never going to show in the first place. Callers (main.js, deciding
// when to start the guided tour) await this so the install ask -- which
// only matters/looks better before the tour runs the user through a
// browser-tab version of a standalone-only UI -- gets first crack.
export function waitForInstallResolution() {
  initInstallPrompt();
  if (alreadyResolved()) return Promise.resolve();
  return new Promise((resolve) => waiters.push(resolve));
}

export async function installNow() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  dismissInstallPrompt();
}

export function dismissInstallPrompt() {
  localStorage.setItem(DISMISS_KEY, '1');
  installBannerState.set({ visible: false, platform: null });
  settle();
}
