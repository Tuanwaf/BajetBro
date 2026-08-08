import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import db from './lib/db.js';
import { seedIfNeeded } from './lib/seed.js';
import { initPersonalizationFlags } from './lib/personalization.js';
import { seedBanksIfNeeded } from './lib/bankPreviewStore.js';
// Guided tour is disabled for now -- see the commented-out block below.
// import { startTour } from './lib/tour.js';
import { initInstallPrompt, isStandalone } from './lib/installPrompt.js';
// `waitForInstallResolution` is only needed by the disabled tour auto-start
// block below -- re-add it to the import above if that comes back.

// Attached as early as possible -- beforeinstallprompt can fire before the
// Svelte app even mounts, and this also starts the grace-period timer (see
// installPrompt.js) that decides how long to give it before giving up.
initInstallPrompt();

// `100dvh` is supposed to track the true visible height on its own, but on
// a fresh standalone-PWA launch iOS has repeatedly been observed reporting
// a dvh value taller than what's actually visible before the WebView's
// layout fully settles -- on a page short enough to not need scrolling
// (the onboarding form), that gap shows up as a visible strip of the raw
// body background below the floating nav dock. `visualViewport.height` is
// the actual current visible height, so mirroring it into a plain px custom
// property (the well-known "--vh hack") sidesteps whatever dvh is doing
// wrong, and re-runs on every resize so it also tracks the keyboard
// opening/closing and orientation changes.
function updateAppVh() {
  const h = (window.visualViewport?.height ?? window.innerHeight) * 0.01;
  document.documentElement.style.setProperty('--app-vh', `${h}px`);
}
updateAppVh();
window.addEventListener('resize', updateAppVh);
window.visualViewport?.addEventListener('resize', updateAppVh);

// Zoom is only locked down once installed to the home screen -- it should
// feel like a native app there, not a webpage, but a regular browser tab
// (Safari, Chrome) is still just a website and should keep normal pinch
// zoom. index.html's viewport meta is permissive by default; this locks it
// down here instead, plus app.css gates its own touch-action:manipulation
// zoom-blocking behind the same `(display-mode: standalone)` media query.
if (isStandalone()) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute(
      'content',
      'width=device-width, initial-scale=1.0, viewport-fit=cover, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no'
    );
  }
  // Belt-and-suspenders alongside that meta tag -- older iOS Safari
  // versions have been inconsistent about honoring it alone, and
  // `gesturestart` is WebKit's own pinch-gesture event, so blocking it
  // directly closes that gap.
  document.addEventListener('gesturestart', (e) => e.preventDefault());
}

async function init() {
  if (navigator.storage?.persist) {
    // Reduces (does not eliminate) eviction risk, notably on iOS Safari.
    await navigator.storage.persist().catch(() => {});
  }

  const minSplashTime = new Promise((resolve) => setTimeout(resolve, 450));

  await seedIfNeeded(db);
  await initPersonalizationFlags(db);
  await seedBanksIfNeeded();

  mount(App, {
    target: document.getElementById('app'),
  });

  // Guided tour is disabled for now -- revisit later if still wanted.
  // The tour now only covers the dashboard/settings/goals/history -- the
  // old first 4 steps that walked through Home's onboarding fields are
  // gone now that OnboardingFlow.svelte handles first-run setup as its own
  // dedicated flow (see tour.js). Starting the tour before that flow has
  // even created a month would try to highlight elements that don't exist
  // yet (OnboardingFlow replaces the tabs entirely until then), so this
  // only fires once a month already exists -- either because onboarding
  // just finished this session (it calls startTour() itself right after),
  // or because a returning user dismissed the tour mid-way on a previous
  // session and it's resuming now.
  //
  // Only after the install-to-home-screen prompt has had its turn: several
  // of this app's visual details (the notch-blur status bar, the floating
  // nav dock sitting flush with the safe area) only render correctly in
  // standalone mode, so touring a browser tab first would walk a first-time
  // user through a visibly worse version of the UI than what they'd get
  // installed. This resolves immediately if already standalone, already
  // dismissed before, or no install prompt shows up within the grace period
  // (see installPrompt.js) -- onboarding never waits on a prompt that isn't
  // coming.
  // const [tourFlag, monthCount] = await Promise.all([db.meta.get('tourCompleted'), db.months.count()]);
  // if (!tourFlag && monthCount > 0) {
  //   waitForInstallResolution().then(startTour);
  // }

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
