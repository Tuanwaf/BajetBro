<script>
  import { flip } from 'svelte/animate';
  import { crossfade, fade } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { getCardDesign, cardBorderColor } from '../lib/constants.js';
  import { banks as bankPreviewStore, focusedBankIndex, addBank, updateBank, deleteBank } from '../lib/bankPreviewStore.js';
  import BankFormSheet from './BankFormSheet.svelte';
  import BankIcon from '../lib/components/BankIcon.svelte';
  import CardPattern from '../lib/components/CardPattern.svelte';

  // Picking a new focus removes that card from the stack's {#each} and adds
  // a brand-new one to the standalone focused block above (different
  // blocks, so plain keyed-list animate:flip can't bridge them) -- crossfade
  // matches an out-transitioning element to an in-transitioning one with the
  // same key and flies it between their two positions instead of fading in
  // place. Unlike the CSS `transition` that caused the earlier snap bug,
  // crossfade is JS-driven (rect-capture-then-transform, the same technique
  // as flip) rather than a plain property transition, so it doesn't fight
  // animate:flip over measurement timing.
  //
  // With more non-focused banks than MAX_PEEKS, collapsing the stack drops
  // several cards from the {#each} at once -- only ONE of them (the old
  // focus) has a matching partner on the other side, so the rest have
  // nothing to pair with. Without a fallback, an unpaired crossfade just
  // vanishes the element instantly, and several cards vanishing in the same
  // frame was what threw off flip's before/after measurements for the
  // cards that *do* survive, reading as the glitchy overlap. Falling back
  // to a plain fade keeps every removal a real (if simple) transition
  // instead of a discontinuity for flip to trip over.
  const [send, receive] = crossfade({
    duration: 380,
    easing: quintOut,
    fallback: (node) => fade(node, { duration: 200 }),
  });

  let { open, onClose } = $props();

  let banksList = $derived($bankPreviewStore);
  let focusedIndex = $derived($focusedBankIndex);
  let focusedEntry = $derived(banksList[focusedIndex] ?? banksList[0]);

  function bankTag(entry) {
    if (entry.bank.isMain) return 'Main bank';
    return entry.bank.type === 'ewallet' ? 'E-wallet' : 'Bank';
  }

  let focusedDesign = $derived(getCardDesign(focusedEntry?.bank?.design));
  let focusedBorderColor = $derived(focusedEntry ? cardBorderColor(focusedEntry.bank) : null);

  // The focused bank always renders first (top of the stack); everything
  // else follows in its normal order underneath. Reordering this array on
  // every focus change -- combined with animate:flip below -- is what
  // makes picking a different card slide it to the top and the old one
  // back down into the stack, instead of just re-rendering in place.
  let orderedBanks = $derived.by(() => {
    if (!banksList.length) return [];
    const list = banksList.slice();
    const [chosen] = list.splice(focusedIndex, 1);
    return [chosen, ...list];
  });

  // Add and edit both open BankFormSheet, stacked on top of this sheet --
  // formMode picks the title/labels, formInitial seeds its fields (empty
  // defaults for add, the focused bank's current values for edit).
  let formOpen = $state(false);
  let formMode = $state('add');
  let formInitial = $state(null);

  // Real Apple Wallet doesn't show the full overlapping stack by default --
  // only the front card plus a peek of the next one behind it. Tapping that
  // peek reveals the full, individually-tappable stack; picking a card from
  // it (or tapping the front card again) collapses back down.
  let stackExpanded = $state(false);

  // Real Wallet peeks show more than one card behind the front one when
  // there are multiple -- capped so a big bank list doesn't turn into an
  // endless wall of slivers.
  const MAX_PEEKS = 5;

  // The focused card renders separately at the top (see markup) with full
  // detail. This list is just the stack underneath it: collapsed, up to
  // MAX_PEEKS peek cards (orderedBanks[1..]); expanded, everything --
  // including the currently-focused bank, which becomes a plain member of
  // the browsing stack like real Wallet does, instead of keeping its detail
  // view (that inconsistency was the original complaint).
  let visibleBanks = $derived(
    stackExpanded ? orderedBanks : orderedBanks.slice(1, 1 + MAX_PEEKS)
  );

  function focusById(id) {
    const i = banksList.findIndex((b) => b.bank.id === id);
    if (i === -1) return;
    focusedBankIndex.set(i);
    stackExpanded = false;
  }

  function onCardTap(entry) {
    if (!stackExpanded) {
      // Collapsed: this is the single peek card. Tapping it reveals the
      // full stack -- picking a specific bank only happens from there.
      stackExpanded = true;
    } else if (entry.bank.id === orderedBanks[0].bank.id) {
      // Expanded: tapping the entry that's still the current focus (always
      // first in orderedBanks) just collapses back without changing it.
      stackExpanded = false;
    } else {
      focusById(entry.bank.id);
    }
  }

  function openAddForm() {
    formMode = 'add';
    formInitial = null;
    formOpen = true;
  }

  function openEditForm() {
    formMode = 'edit';
    formInitial = {
      name: focusedEntry.bank.name,
      balance: focusedEntry.balance,
      type: focusedEntry.bank.type,
      isMain: focusedEntry.bank.isMain,
      color: focusedEntry.bank.color,
      icon: focusedEntry.bank.icon,
      logo: focusedEntry.bank.logo,
      design: focusedEntry.bank.design,
      income: focusedEntry.income,
      spending: focusedEntry.spending,
    };
    formOpen = true;
  }

  async function handleFormSubmit(data) {
    if (formMode === 'add') {
      await addBank(data);
    } else {
      await updateBank(focusedIndex, data);
    }
    formOpen = false;
  }

  async function handleFormDelete() {
    if (banksList.length <= 1) return showToast("You need at least one bank");
    await deleteBank(focusedIndex);
    formOpen = false;
    showToast('Removed');
  }

  $effect(() => {
    if (!open) stackExpanded = false;
  });
</script>

<div class="sheet" class:open>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>Your banks</h2>
    <button class="add-link" onclick={openAddForm}>Add</button>
  </div>
  <div class="sheet-body">
    <div class="sheet-body-top">
      <p class="hint" style="margin:0 4px 14px;">Tap the card above to edit it, or the list below to pick a different one as your main focus on Home.</p>

      <div class="hero-slot" class:active={!stackExpanded}>
        {#if !stackExpanded && focusedEntry}
          <div
            class="stack-card focused"
            style="border-color:{focusedBorderColor}; box-shadow:5px 5px 0 {focusedBorderColor}; background:{focusedDesign.bg}; --card-fg:{focusedDesign.fg}; --card-dim:{focusedDesign.dim};"
            in:receive={{ key: focusedEntry.bank.id }}
            out:send={{ key: focusedEntry.bank.id }}
          >
            <CardPattern kind={focusedDesign.pattern} color={focusedDesign.patternColor} opacity={focusedDesign.patternOpacity} />
            <button class="stack-card-face" onclick={openEditForm}>
              <div class="stack-card-top">
                <BankIcon logo={focusedEntry.bank.logo} icon={focusedEntry.bank.icon} name={focusedEntry.bank.name} color={focusedEntry.bank.color} />
                <div class="bank-id-text">
                  <div class="bank-name">{focusedEntry.bank.name}</div>
                  <div class="bank-tag">{bankTag(focusedEntry)}</div>
                </div>
                <div class="bank-brand">BAJETBRO</div>
              </div>
              <div class="stack-detail">
                <div class="bank-balance-lbl">Balance</div>
                <div class="bank-balance-amt"><span class="cur">RM</span>{fmt(focusedEntry.balance)}</div>
                <div class="bank-stats-row">
                  <div class="bank-stat">
                    <div class="k">Income</div>
                    <div class="v" style="color:var(--good);">RM {fmt(focusedEntry.income)}</div>
                  </div>
                  <div class="bank-stat right">
                    <div class="k">Spending</div>
                    <div class="v" style="color:var(--red);">RM {fmt(focusedEntry.spending)}</div>
                  </div>
                </div>
              </div>
            </button>
          </div>
        {/if}
      </div>
    </div>

    <!-- Collapsed: up to MAX_PEEKS cards behind the focused one, each
         rendering its full real face -- the peek effect comes from the
         overlap tucking part of each card behind the one in front, tightly
         stacked and narrowing with depth, pinned to the bottom of the sheet
         (real Wallet leaves a big empty gap under the front card, not a
         small margin). Expanded: the full browsing stack, including the
         card that was just focused above -- it becomes a plain member of
         the stack like everything else, which is what real Wallet does;
         normal top-down flow here, not bottom-pinned, since it can be
         longer than the screen.

         animate:flip (+ the .stack-card transition below) animates
         position/size for cards that stay in THIS list as they resize
         between sliver/last/full (MAX_PEEKS or stackExpanded changing).
         in:receive/out:send (crossfade, set up in the script) animates a
         card CROSSING into/out of this list -- i.e. the focused card above,
         which lives in a separate {#if} block flip can't reach on its own.
         Picking a card here removes it from this {#each} and it flies up to
         become that block's content; expanding does the reverse. -->
    <div class="stack-wrap" class:expanded={stackExpanded}>
      <div class="bank-stack">
        {#each visibleBanks as entry, i (entry.bank.id)}
          {@const isLast = i === visibleBanks.length - 1}
          {@const isSliver = !stackExpanded && !isLast}
          {@const depth = visibleBanks.length - 1 - i}
          {@const design = getCardDesign(entry.bank.design)}
          {@const borderColor = cardBorderColor(entry.bank)}
          <div
            class="stack-card"
            class:last={isLast}
            class:sliver={isSliver}
            style="border-color:{borderColor}; box-shadow:5px 5px 0 {borderColor}; z-index:{i + 1}; background:{design.bg}; --card-fg:{design.fg}; --card-dim:{design.dim};{isSliver ? ` margin-left:${(depth + 1) * 9}px; margin-right:${(depth + 1) * 9}px;` : ''}"
            animate:flip={{ duration: 380, easing: quintOut }}
            in:receive={{ key: entry.bank.id }}
            out:send={{ key: entry.bank.id }}
          >
            <CardPattern kind={design.pattern} color={design.patternColor} opacity={design.patternOpacity} />
            <button class="stack-card-face" onclick={() => onCardTap(entry)}>
              <div class="stack-card-top">
                <BankIcon logo={entry.bank.logo} icon={entry.bank.icon} name={entry.bank.name} color={entry.bank.color} />
                <div class="bank-id-text">
                  <div class="bank-name">{entry.bank.name}</div>
                  <div class="bank-tag">{bankTag(entry)}</div>
                </div>
                <div class="bank-brand">BAJETBRO</div>
              </div>
              <div class="stack-detail">
                <div class="bank-balance-lbl">Balance</div>
                <div class="bank-balance-amt"><span class="cur">RM</span>{fmt(entry.balance)}</div>
                <div class="bank-stats-row">
                  <div class="bank-stat">
                    <div class="k">Income</div>
                    <div class="v" style="color:var(--good);">RM {fmt(entry.income)}</div>
                  </div>
                  <div class="bank-stat right">
                    <div class="k">Spending</div>
                    <div class="v" style="color:var(--red);">RM {fmt(entry.spending)}</div>
                  </div>
                </div>
              </div>
            </button>
          </div>
        {/each}
      </div>
    </div>

  </div>
</div>

<BankFormSheet
  open={formOpen}
  mode={formMode}
  initial={formInitial}
  onClose={() => (formOpen = false)}
  onSubmit={handleFormSubmit}
  onDelete={formMode === 'edit' ? handleFormDelete : null}
/>

<style>
  .add-link { background: none; border: none; font-size: 15px; font-weight: 700; color: var(--gold); padding: 4px; }

  /* .sheet-body is flex:1 with overflow-y:auto (app.css) -- turning it into
     a column flex container here lets .stack-wrap grow to fill whatever's
     left and push the peek stack down to the true bottom of the visible
     sheet, like real Wallet, instead of a fixed guess-a-margin gap. */
  .sheet-body { display: flex; flex-direction: column; }
  .sheet-body-top { flex-shrink: 0; }
  /* Svelte keeps an out-transitioning element in the DOM (at its full,
     normal-flow size) for the whole crossfade duration, then removes it --
     so .sheet-body-top's height stayed full-size the entire time the
     focused card was flying away, then instantly collapsed the moment
     crossfade finished, and everything below (the peek stack) jumped up to
     fill that gap in one frame. That jump, not the crossfade/flip
     animations themselves, was the "merges, then snaps" the card.

     max-height + overflow:hidden, transitioning down to 0 in sync (same
     0.38s), forces the box to actually shrink on that same timeline instead
     of just riding along with content -- min-height (an earlier attempt)
     doesn't work here: it only sets a FLOOR, so it's a no-op the instant
     content (the still-present, still-fading card) is taller than it, which
     it is for this entire transition. Overflow:hidden means the fading card
     gets progressively clipped as this shrinks -- an acceptable trade for
     not jumping, since it's already flying/fading via crossfade at the same
     time. Only fixes the shrinking (expand) direction -- growing (collapse)
     doesn't have this problem because the card's real height is already
     there the instant it mounts, before this transition even matters. */
  /* The focused card's box-shadow bleeds 5px past its own right edge --
     overflow:hidden above would clip that, so pad the right side by the
     same amount and cancel the added width with a matching negative
     margin (same trick already used for this in BankCarousel.svelte). */
  .hero-slot { max-height: 0; overflow: hidden; transition: max-height 0.1s; padding-right: 5px; margin-right: -5px; }
  /* Generously above the card's real height (~205px) -- this only needs to
     never constrain the stable/active state, not match it exactly. */
  .hero-slot.active { max-height: 400px; }
  .stack-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .stack-wrap.expanded { justify-content: flex-start; }
  /* Nudges the collapsed peek stack further down, closer to the true
     bottom of the sheet, eating into .sheet-body's own bottom padding. */
  .stack-wrap:not(.expanded) { margin-bottom: -65px; }

  .bank-stack { display: flex; flex-direction: column; }

  .stack-card {
    background: var(--panel);
    border: 2px solid var(--stroke-2);
    border-radius: 22px;
    position: relative;
    /* z-index:auto (the default) does NOT create a local stacking context
       even with position:relative set -- CardPattern's own negative
       z-index would then escape to whatever ancestor context is next up
       the tree instead of staying scoped to this card, which is exactly
       what hid it on the focused card (the peek/stack cards happened to
       work already because they separately set a numeric z-index inline,
       for their own overlap-ordering reasons). Any non-auto value fixes
       it; the peek cards' inline z-index still overrides this per-card. */
    z-index: 0;
    /* Clips CardPattern (the design's line-art, see markup) to the card's
       own rounded corners -- doesn't affect the card's own box-shadow,
       which paints outside the border box regardless of its overflow. */
    overflow: hidden;
    /* Each card overlaps roughly half of the previous one -- tall enough
       that the later (further-from-focus) card visibly tucks the earlier
       one's bottom half behind it, like a real fanned-out stack, instead of
       almost fully showing both. z-index (see markup, increases with list
       position) makes the later card paint on top of that overlap so it
       reads as being in front, not behind. */
    margin-bottom: -95px;
    transition: margin 0.38s, height 0.38s;
  }
  .stack-card.focused { margin-bottom: 14px; }
  /* The front-most peek (last-rendered, highest z-index) must NOT carry the
     negative overlap -- it has nothing after it to tuck under, and a
     trailing negative margin on the very last flex child shrinks the
     container's own height, clipping that card's own bottom. */
  .stack-card.last { margin-bottom: 14px; }
  /* Collapsed peek stack: everything behind the front card crops down to
     just a thin sliver of its rounded top edge (no readable content),
     tightly bunched (small overlap, not the ~half-height one above) so the
     whole group reads as close together instead of spread out. The
     progressive left/right inset (inline style, depth-based) is what makes
     each one look narrower than the card in front of it. */
  .stack-card.sliver {
    height: 16px;
    overflow: hidden;
    margin-bottom: -9px;
  }
  /* Every card in the stack -- peeking or fully expanded -- renders its
     real face (header + balance/stats), full height. The "peek" look comes
     purely from the overlap above tucking part of it behind the card in
     front, not from cropping the content down to a name-only strip. */
  .stack-card-face {
    display: block;
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    text-align: left;
  }

  .stack-card-top {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    background: none;
    border: none;
    padding: 16px 18px;
    text-align: left;
  }
  .bank-id-text { flex: 1; min-width: 0; }
  /* Buttons default to the OS's blue tint color on iOS Safari when no
     color is set -- bank-name and bank-balance-amt sit inside buttons here,
     so they need an explicit color instead of relying on inheritance. */
  .bank-name { font-weight: 700; font-size: 14.5px; color: var(--card-fg, var(--hi)); }
  .bank-tag { font-size: 10.5px; color: var(--card-dim, var(--dim)); font-weight: 600; margin-top: 1px; }
  .bank-brand {
    font-family: var(--display); font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em;
    color: var(--card-dim, var(--dim)); text-transform: uppercase; flex-shrink: 0;
  }

  .stack-detail { padding: 0 18px 18px; }
  .bank-balance-lbl { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--card-dim, var(--dim)); }
  .bank-balance-amt {
    font-family: var(--mono); font-variant-numeric: tabular-nums;
    font-size: 32px; font-weight: 700; letter-spacing: -0.01em;
    margin: 3px 0 14px;
    color: var(--card-fg, var(--hi));
  }
  .bank-balance-amt .cur { font-size: 15px; color: var(--card-dim, var(--dim)); font-weight: 600; margin-right: 3px; }
  .bank-stats-row { display: flex; justify-content: space-between; align-items: flex-start; }
  .bank-stat.right { text-align: right; }
  .bank-stat .k { font-size: 10.5px; color: var(--card-dim, var(--dim)); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .bank-stat .v { font-size: 14px; font-weight: 700; margin-top: 3px; }
</style>
