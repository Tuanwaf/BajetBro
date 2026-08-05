<script>
  import { tourActive } from '../tour.js';
  import { installBannerState, installNow, dismissInstallPrompt } from '../installPrompt.js';

  let { hidden = false } = $props();

  // Suppressed while the first-run guided tour is active (main.js now waits
  // for this banner to resolve before starting that tour, so this is mostly
  // a backstop for a late-arriving beforeinstallprompt) or a full-screen
  // sheet is open (Add Expense, End Month), which sits at a lower z-index
  // and would otherwise look like a stray card floating over an active
  // modal.
  let visible = $derived($installBannerState.visible && !$tourActive && !hidden);
  let platform = $derived($installBannerState.platform);
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
          <button class="install-btn" onclick={dismissInstallPrompt}>Got it</button>
        </div>
      {:else}
        <p class="install-msg">Works better as an app on your device.</p>
        <div class="install-actions">
          <button class="install-btn" onclick={installNow}>Install</button>
          <button class="install-later" onclick={dismissInstallPrompt}>Not now</button>
        </div>
      {/if}
    </div>
    <button class="install-x" aria-label="Dismiss" onclick={dismissInstallPrompt}>
      <svg viewBox="0 0 24 24" fill="none"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
    </button>
  </div>
{/if}
