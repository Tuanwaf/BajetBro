<script>
  import BankCard from './BankCard.svelte';

  // Controlled component, not $bindable -- activeIndex can come from a
  // derived store value (Settings' "Manage banks" sheet can also change
  // which bank is focused), and Svelte doesn't allow binding to a derived.
  // onNavigate reports scroll-driven changes back up; the effect below
  // scrolls to activeIndex whenever it changes from OUTSIDE (a tap in
  // Settings), so the two stay in sync either direction.
  let { banks = [], activeIndex = 0, onNavigate = () => {} } = $props();

  let scrollerEl = $state(null);

  function onScroll() {
    if (!scrollerEl) return;
    const idx = Math.round(scrollerEl.scrollLeft / scrollerEl.clientWidth);
    if (idx !== activeIndex) onNavigate(idx);
  }

  function syncScroll() {
    if (!scrollerEl || !scrollerEl.clientWidth) return;
    const targetLeft = activeIndex * scrollerEl.clientWidth;
    if (Math.abs(scrollerEl.scrollLeft - targetLeft) > 4) {
      scrollerEl.scrollTo({ left: targetLeft, behavior: 'instant' });
    }
  }

  $effect(() => {
    activeIndex;
    syncScroll();
  });

  // Home stays mounted with display:none while another tab is active (all
  // four tabs always are, see App.svelte), so clientWidth reads 0 if the
  // focused bank changes elsewhere (Settings' "Manage banks" sheet) while
  // Home isn't the visible tab -- the effect above silently no-ops on a
  // zero width. A ResizeObserver catches the moment Home becomes visible
  // again (clientWidth flips from 0 to real) and re-syncs then.
  $effect(() => {
    if (!scrollerEl) return;
    const ro = new ResizeObserver(syncScroll);
    ro.observe(scrollerEl);
    return () => ro.disconnect();
  });
</script>

<div class="carousel" bind:this={scrollerEl} onscroll={onScroll}>
  {#each banks as b, i (b.bank.id)}
    <div class="slide">
      <BankCard bank={b.bank} balance={b.balance} income={b.income} spending={b.spending} isMain={i === 0} />
    </div>
  {/each}
</div>
{#if banks.length > 1}
  <div class="dots">
    {#each banks as _, i}
      <span class:active={i === activeIndex}></span>
    {/each}
  </div>
{/if}

<style>
  .carousel {
    display: flex;
    /* Wider than it looks like it needs to be: each card's box-shadow
       bleeds 5px past its own right edge into this gap, and scroll-snap
       lands within a couple px of exact (not perfectly pixel-precise), so
       a tight gap let the previous card's shadow peek in from the left
       after swiping. 28px leaves real headroom past both of those. */
    gap: 28px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    /* overflow-x:auto also clips vertically (overflow-y computes to auto per
       spec once overflow-x isn't visible), so each card's 5px offset
       box-shadow needs padding on the right/bottom to avoid being cut off.
       Padding/margin MUST be symmetric left-right: an earlier asymmetric
       version (small on the left, large on the right, to only cover the
       side the shadow actually falls on) canceled out in TOTAL width but
       shifted the whole carousel rightward, since the auto-width box model
       only balances the sum, not each side independently. Symmetric padding
       wastes a little clipping room on the left (nothing bleeds that way),
       but keeps the box centered exactly where it'd sit with no padding
       at all. */
    padding: 2px 12px 12px 12px;
    margin: 0 -12px 0 -12px;
    scrollbar-width: none;
  }
  .carousel::-webkit-scrollbar { display: none; }
  .slide { scroll-snap-align: center; flex: 0 0 100%; min-width: 0; }
  .dots { display: flex; justify-content: center; gap: 6px; margin-bottom: 14px; }
  .dots span { width: 6px; height: 6px; border-radius: 50%; background: var(--stroke); transition: background 0.2s ease, transform 0.2s ease; }
  .dots span.active { background: var(--stroke-2); transform: scale(1.3); }
</style>
