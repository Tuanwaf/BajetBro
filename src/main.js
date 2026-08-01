import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import db from './lib/db.js';
import { seedIfNeeded } from './lib/seed.js';
import { initPersonalizationFlags } from './lib/personalization.js';
import { startTour } from './lib/tour.js';

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
