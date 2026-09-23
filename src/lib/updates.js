import { writable } from 'svelte/store';
import { registerSW } from 'virtual:pwa-register';

// App updates, on the user's terms.
//
// The service worker downloads a new build in the background but (with
// vite.config.js's registerType: 'prompt') leaves it WAITING instead of
// taking over. Once one is waiting, the live version.json is fetched --
// bypassing every cache -- for its version number and release notes, and
// the update banner appears. Nothing is reloaded until the user taps
// Update, so a half-typed entry is never lost to a surprise reload.
//
// The banner is only ever raised by the service worker saying an update is
// actually downloaded and ready -- version.json just supplies the words.
// That way it can't announce an update that isn't there, and tapping Update
// never lands on a half-downloaded one.

// { version, notes: string[] } while an update is waiting to be applied.
export const updateAvailable = writable(null);
export const updating = writable(false);

let applyUpdate = null;
let registration = null;

async function fetchLiveVersion() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch {
    return null;
  }
}

async function announce() {
  const live = await fetchLiveVersion();
  // A waiting worker whose build has the same version as this one (e.g. a
  // redeploy without a version bump) still gets offered -- it's a real,
  // newer build -- just without a version jump to show.
  updateAvailable.set({
    version: live?.version ?? null,
    notes: Array.isArray(live?.notes) ? live.notes : [],
  });
}

// iOS in particular only checks for a new service worker when the app is
// launched, and a home-screen app can sit suspended for days -- so check
// again whenever it comes back to the foreground, and every half hour while
// it stays open.
function checkNow() {
  registration?.update().catch(() => {});
}

export function initUpdates() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh: announce,
    onRegisteredSW(_url, r) {
      registration = r;
      if (!r) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkNow();
      });
      setInterval(checkNow, 30 * 60 * 1000);
    },
  });
}

// Activates the waiting build and reloads straight into it.
export async function installUpdate() {
  updating.set(true);
  if (!applyUpdate) return window.location.reload();
  try {
    await applyUpdate(true);
  } catch {
    window.location.reload();
  }
  // If the page somehow wasn't reloaded (the worker was already gone),
  // don't leave the banner spinning forever.
  setTimeout(() => window.location.reload(), 4000);
}

// Dev mode: shows the banner with made-up content, no service worker needed.
export function previewUpdateBanner() {
  updateAvailable.set({
    version: '9.9.9',
    notes: ['This is a preview of the update banner.', 'Tapping Update would restart into the new version.', 'Nothing is actually installed.'],
    preview: true,
  });
}
