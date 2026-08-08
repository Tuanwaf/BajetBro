<script>
  // Shared so the same glyph renders identically everywhere a bank's logo
  // spot shows up (Home's carousel, Settings' bank stack, the add/edit
  // form's preview and icon picker) -- one place to add a new generic icon
  // or swap in a real logo. Priority: logo (real bank/e-wallet SVG, see
  // public/icons/banks/) > icon (hand-drawn generic glyph) > name initial.
  let { logo = null, icon = null, name = '', color = '#6e8bff', size = 32 } = $props();
</script>

<span
  class="bank-icon"
  class:has-logo={!!logo}
  style="background:{color}; width:{size}px; height:{size}px; border-radius:{Math.round(size * 0.3)}px; font-size:{Math.round(size * 0.47)}px;"
>
  {#if logo}
    <img src="{import.meta.env.BASE_URL}icons/banks/{logo}.svg" alt="" width="100%" height="100%" />
  {:else if icon === 'bank'}
    <svg viewBox="0 0 24 24" fill="none" width="60%" height="60%"><path d="M3 21h18M4 21V10.5M20 21V10.5M2 10.5 12 4l10 6.5M7 10.5V21M12 10.5V21M17 10.5V21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
  {:else if icon === 'wallet'}
    <svg viewBox="0 0 24 24" fill="none" width="60%" height="60%"><path d="M3 7a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v1h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="16" cy="13.5" r="1.3" fill="currentColor"/></svg>
  {:else if icon === 'card'}
    <svg viewBox="0 0 24 24" fill="none" width="60%" height="60%"><rect x="2.5" y="6" width="19" height="13" rx="2.2" stroke="currentColor" stroke-width="1.6"/><path d="M2.5 10h19" stroke="currentColor" stroke-width="1.6"/></svg>
  {:else if icon === 'cash'}
    <svg viewBox="0 0 24 24" fill="none" width="60%" height="60%"><rect x="2" y="6.5" width="20" height="11" rx="1.8" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="2.6" stroke="currentColor" stroke-width="1.6"/></svg>
  {:else}
    {name.trim() ? name.trim()[0].toUpperCase() : '?'}
  {/if}
</span>

<style>
  .bank-icon {
    flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: var(--accent-ink); font-family: var(--display); font-weight: 800;
    border: 1.5px solid var(--stroke-2);
    overflow: hidden;
  }
  /* Real logos already carry their own background/rounded-rect (baked into
     the SVG) -- drop ours instead of showing a colored ring around it. */
  .bank-icon.has-logo { background: none; border: none; }
  .bank-icon img { width: 100%; height: 100%; }
</style>
