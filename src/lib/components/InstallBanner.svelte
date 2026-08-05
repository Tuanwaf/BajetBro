<script>
  import { onMount } from 'svelte';
  import { tourActive } from '../tour.js';

  let { hidden = false } = $props();

  const DISMISS_KEY = 'bb-install-dismissed';

  let eligible = $state(false);
  let platform = $state(null); // 'android' | 'ios'
  let deferredPrompt = null;

  // Never shows once installed, or once the user has dismissed/installed
  // via this banner before -- re-nagging a user who already said no isn't
  // the same as "helping a first-time user find the install option".
  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }

  onMount(() => {
    if (isStandalone() || localStorage.getItem(DISMISS_KEY)) return;

    // Chrome/Edge/Samsung Internet etc. fire this when the site meets their
    // install criteria (valid manifest + service worker, already true here).
    // preventDefault() lets us hold onto the event and trigger the native
    // install flow ourselves, from our own button, whenever we want.
    function onBeforeInstallPrompt(e) {
      e.preventDefault();
      deferredPrompt = e;
      platform = 'android';
      eligible = true;
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);

    // iOS Safari (and every other iOS browser, since they're all WebKit
    // under the hood) has no install API at all -- beforeinstallprompt
    // never fires there, and there is no way for a web page to trigger
    // installation without the user opening the share sheet themselves.
    // This branch is instructions, not a one-tap action.
    if (isIOS()) {
      platform = 'ios';
      eligible = true;
    }

    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  });

  // Don't compete with the first-run guided tour for attention -- a brand
  // new install already auto-starts that tour (see main.js) -- or float on
  // top of an open full-screen sheet (Add Expense, End Month), which sits
  // at a lower z-index and would otherwise look like a stray card floating
  // over an active modal.
  let visible = $derived(eligible && !$tourActive && !hidden);

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    eligible = false;
    localStorage.setItem(DISMISS_KEY, '1');
  }

  function dismiss() {
    eligible = false;
    localStorage.setItem(DISMISS_KEY, '1');
  }
</script>

{#if visible}
  <div class="install-banner">
    <div class="install-icon">
      {#if platform === 'ios'}
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 7.5 12 3l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.5 10.5 12 15l4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 15v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {/if}
    </div>
    <div class="install-body">
      {#if platform === 'ios'}
        <p class="install-msg">Works better as an app on your device — tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.</p>
        <div class="install-actions">
          <button class="install-btn" onclick={dismiss}>Got it</button>
        </div>
      {:else}
        <p class="install-msg">Works better as an app on your device.</p>
        <div class="install-actions">
          <button class="install-btn" onclick={install}>Install</button>
          <button class="install-later" onclick={dismiss}>Not now</button>
        </div>
      {/if}
    </div>
    <button class="install-x" aria-label="Dismiss" onclick={dismiss}>
      <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  </div>
{/if}
