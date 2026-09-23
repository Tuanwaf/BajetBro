<script>
  import { updateAvailable, updating, installUpdate } from '../updates.js';

  // "Later" hides it for this session only -- the update keeps waiting and
  // the banner comes back the next time the app is opened.
  let dismissed = $state(false);
  let expanded = $state(false);

  let u = $derived($updateAvailable);
  let show = $derived(!!u && !dismissed);
  let jump = $derived(u?.version && u.version !== __APP_VERSION__ ? `v${__APP_VERSION__} → v${u.version}` : `v${__APP_VERSION__} → latest`);
  // First three notes up front; the rest behind "What's new".
  let shownNotes = $derived(u ? (expanded ? u.notes : u.notes.slice(0, 3)) : []);

  function update() {
    if (u?.preview) {
      dismissed = true;
      updateAvailable.set(null);
      return;
    }
    installUpdate();
  }
</script>

{#if show}
  <!-- Centred dialog over a dimmed backdrop. Tapping the backdrop does
       nothing on purpose -- Later / Update now are the only ways out, so it
       can't be dismissed by a stray tap. -->
  <div class="update-overlay">
  <div class="update-banner" role="dialog" aria-modal="true" aria-label="Update available">
    <div class="hd">
      <span class="badge" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </span>
      <div class="hd-text">
        <div class="title">Update available</div>
        <div class="ver num">{jump}</div>
      </div>
    </div>

    {#if u.notes.length}
      <ul class="notes">
        {#each shownNotes as n}
          <li>{n}</li>
        {/each}
      </ul>
      {#if u.notes.length > 3}
        <button class="more" onclick={() => (expanded = !expanded)}>{expanded ? 'Show less' : `What's new (${u.notes.length - 3} more)`}</button>
      {/if}
    {/if}

    <div class="actions">
      <button class="io-btn" disabled={$updating} onclick={() => (dismissed = true)}>Later</button>
      <button class="save-btn" disabled={$updating} onclick={update}>
        {#if $updating}Updating…{:else}Update now{/if}
      </button>
    </div>
    <p class="fine">The app restarts on the new version. Your data stays on this device.</p>
  </div>
  </div>
{/if}

<style>
  .update-overlay {
    position: fixed; inset: 0;
    z-index: 190;
    display: flex; align-items: center; justify-content: center;
    padding: calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 16px);
    background: rgba(17, 19, 24, 0.55);
    -webkit-backdrop-filter: blur(3px);
    backdrop-filter: blur(3px);
    animation: fade-in 0.25s ease;
  }
  @keyframes fade-in { from { opacity: 0; } }
  .update-banner {
    width: 100%;
    max-width: 400px;
    /* A long "What's new" list scrolls inside the card instead of running
       off a short screen. */
    max-height: 100%;
    overflow-y: auto;
    background: var(--panel);
    border: 2px solid var(--stroke-2);
    border-radius: 20px;
    box-shadow: 4px 4px 0 var(--stroke-2);
    padding: 16px 16px 12px;
    animation: pop-in 0.4s cubic-bezier(0.25, 1.4, 0.5, 1);
  }
  @keyframes pop-in { from { opacity: 0; transform: scale(0.88); } }
  .hd { display: flex; align-items: center; gap: 10px; }
  .badge {
    width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: var(--gold); color: var(--accent-ink);
    border: 2px solid var(--stroke-2);
  }
  .title { font-family: var(--display); font-size: 16px; font-weight: 800; }
  .ver { font-size: 12px; color: var(--dim); margin-top: 1px; }
  .notes { margin: 10px 0 0; padding-left: 18px; font-size: 13px; color: var(--lo); line-height: 1.45; }
  .notes li + li { margin-top: 4px; }
  .more { background: none; border: none; padding: 6px 0 0; font-size: 12.5px; font-weight: 700; color: var(--gold); }
  .actions { display: flex; gap: 8px; margin-top: 12px; }
  .actions > * { flex: 1; margin-top: 0; }
  .actions button:disabled { opacity: 0.6; }
  .fine { font-size: 11px; color: var(--dim); margin: 8px 0 0; text-align: center; }
  @media (prefers-reduced-motion: reduce) { .update-overlay, .update-banner { animation: none; } }
</style>
