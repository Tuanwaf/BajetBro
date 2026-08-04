import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import db from './lib/db.js';
import { seedIfNeeded } from './lib/seed.js';
import { initPersonalizationFlags } from './lib/personalization.js';
import { startTour } from './lib/tour.js';

// Belt-and-suspenders against pinch-zoom alongside the viewport meta's
// user-scalable=no and app.css's touch-action:manipulation -- older iOS
// Safari versions have been inconsistent about honoring the meta tag alone,
// and `gesturestart` is WebKit's own pinch-gesture event, so blocking it
// directly closes that gap. Should feel like a native app, not a webpage.
document.addEventListener('gesturestart', (e) => e.preventDefault());

async function init() {
  if (navigator.storage?.persist) {
    // Reduces (does not eliminate) eviction risk, notably on iOS Safari.
    await navigator.storage.persist().catch(() => {});
  }

  const minSplashTime = new Promise((resolve) => setTimeout(resolve, 450));

  await seedIfNeeded(db);
  await initPersonalizationFlags(db);

  mount(App, {
    target: document.getElementById('app'),
  });

  // A genuinely fresh install (personalization migration found nothing to
  // grandfather it against) starts the guided tour automatically.
  if (!(await db.meta.get('tourCompleted'))) {
    startTour();
  }

  // Keep the splash up briefly even on a fast/warm load, so its pulse is
  // actually visible rather than flashing past in a frame or two.
  await minSplashTime;
  const splash = document.getElementById('splash');
  if (splash) {
    splash.classList.add('splash-hide');
    splash.addEventListener('transitionend', () => splash.remove(), { once: true });
  }
}

init();
