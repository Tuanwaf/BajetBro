<script>
  import { flip } from 'svelte/animate';
  import { crossfade, fade } from 'svelte/transition';
  import { quintOut } from 'svelte/easing';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { getCardDesign, cardBorderColor, bankTypeLabel } from '../lib/constants.js';
  import { banks as bankPreviewStore, focusedBankIndex, addBank, updateBank, deleteBank, bankHasHistory } from '../lib/bankPreviewStore.js';
  import { sheetPageCount } from '../lib/viewStore.js';
  import { swipeBack } from '../lib/swipeBack.js';
  import db from '../lib/db.js';
  import Sortable from 'sortablejs';
  import BankFormSheet from './BankFormSheet.svelte';
  import BankIcon from '../lib/components/BankIcon.svelte';
  import CardPattern from '../lib/components/CardPattern.svelte';
  import WalletStack from '../lib/components/WalletStack.svelte';

  // Same SortableJS wrapper as Settings' Fixed categories/Buffer labels --
  // see that file's comment for why (a hand-rolled Pointer Events drag and
  // an up/down stepper were both tried and dropped first). The card stack
  // below is its own tap-to-focus browsing gesture, layering a drag gesture
  // onto its overlapping cards would fight that -- this is a separate,
  // plain flat list purely for setting the order, same pattern as those.
  function sortable(node, options) {
    const instance = Sortable.create(node, options);
    return { destroy: () => instance.destroy() };
  }

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

  // Doesn't participate in openSheetCount (see viewStore.js) -- see
  // BankFormSheet.svelte's comment on the same removal for why: this is a
  // .sheet-page sharing the root document scroll now, not a position:fixed
  // overlay, and Settings' own content behind it is already fully
  // display:none rather than just visually covered. Registers on
  // sheetPageCount instead, so the tab bar hides while this is showing.
  let { open, onClose } = $props();

  $effect(() => {
    if (!open) return;
    sheetPageCount.update((n) => n + 1);
    return () => sheetPageCount.update((n) => n - 1);
  });

  let banksList = $derived($bankPreviewStore);
  let focusedIndex = $derived($focusedBankIndex);
  let focusedEntry = $derived(banksList[focusedIndex] ?? banksList[0]);

  function bankTag(entry) {
    if (entry.bank.isMain) return 'Main bank';
    return bankTypeLabel(entry.bank.type);
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
  let balanceLocked = $state(false);

  // Same reasoning as Settings.svelte's manageBanksOpen effect -- Bank Form
  // now shares the root document scroll too, so it needs its own top-reset
  // on open/close instead of showing at whatever scroll offset the bank
  // list happened to be at.
  $effect(() => {
    formOpen;
    window.scrollTo(0, 0);
  });

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
    balanceLocked = false;
    formOpen = true;
  }

  // WalletStack's own "tap to focus, tap again to edit" gesture (see its
  // cardCapture) -- focuses the tapped bank first so openEditForm below
  // (which reads focusedEntry/focusedIndex, not a parameter) edits the
  // right one, same as tapping through the old stack UI used to.
  function editBankFromWallet(bank) {
    const i = banksList.findIndex((b) => b.bank.id === bank.id);
    if (i === -1) return;
    focusedBankIndex.set(i);
    openEditForm();
  }

  function openEditForm() {
    formMode = 'edit';
    // Balance is only ever hand-typed before a bank has any real
    // transaction -- see bankHasHistory's comment in bankPreviewStore.js.
    balanceLocked = bankHasHistory(focusedEntry.bank.id);
    formInitial = {
      name: focusedEntry.bank.name,
      balance: focusedEntry.balance,
      fixedDeposit: focusedEntry.fixedDeposit,
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

  async function handleFormDelete(promoteMainId) {
    if (banksList.length <= 1) return showToast("You need at least one bank");
    await deleteBank(focusedIndex, { promoteMainId });
    formOpen = false;
    showToast('Removed');
  }

  // banksList is already sorted by `order` (see stores.js's db.banks.orderBy)
  // -- SortableJS has already moved the dragged row's DOM node by the time
  // onEnd fires, so this just confirms the same new order back into Dexie,
  // re-numbering everyone gaplessly same as deleteBank does.
  async function handleBankReorder(evt) {
    const { oldIndex, newIndex } = evt;
    if (oldIndex === newIndex) return;
    // focusedBankIndex is a plain index into banksList (see its own
    // declaration above) -- reordering shifts what sits at every index, so
    // without this the stack's focused card would silently jump to
    // whichever bank happens to land on the old index instead of staying
    // on the one that was actually focused.
    const focusedId = banksList[focusedIndex]?.bank.id;
    const reordered = banksList.slice();
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    await Promise.all(reordered.map((entry, i) => db.banks.update(entry.bank.id, { order: i })));
    if (focusedId) {
      const newFocusedIndex = reordered.findIndex((entry) => entry.bank.id === focusedId);
      if (newFocusedIndex !== -1) focusedBankIndex.set(newFocusedIndex);
    }
  }

  // This page is meant to just show the cards -- Organize opens as its own
  // half-height bottom sheet on top of it instead of living inline here, so
  // the card stack (and its own tap-to-focus/expand gestures) stays the only
  // thing this page's body is about.
  let organizeOpen = $state(false);

  $effect(() => {
    if (!open) {
      stackExpanded = false;
      organizeOpen = false;
    }
  });
</script>

<div class="sheet-page" class:open use:swipeBack={onClose}>
  <div style:display={formOpen ? 'none' : 'contents'}>
  <div class="sheet-page-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>Your banks</h2>
    <div style="display:flex; gap:6px;">
      {#if banksList.length > 1}
        <button class="add-link" aria-label="Organize banks" onclick={() => (organizeOpen = true)}>
          <svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          Organize
        </button>
      {/if}
      <button class="add-link" onclick={openAddForm}>
        <svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        Add
      </button>
    </div>
  </div>
  <div class="sheet-page-body">
    <div class="sheet-body-top">
      <p class="hint" style="margin:0 4px 14px;">Tap the card above to edit it, or the list below to pick a different one as your main focus on Home.</p>

      <!-- PROTOTYPE -- tap-adapted uiverse wallet-stack experiment (see
           WalletStack.svelte). Remove this block (and the import above) once
           a call is made on whether to keep it. -->
      <WalletStack banks={banksList} onEditBank={editBankFromWallet} collapse={organizeOpen} />

      <!-- Old card-stack browsing UI, disabled while WalletStack above is
           the focus (see the PROTOTYPE comment) -- kept intact, not deleted,
           behind {#if false} so it's a one-line flip back if needed. -->
      {#if false}
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
                <div class="bank-balance-amt">
                  <span class="cur">RM</span>{fmt(focusedEntry.balance)}
                </div>
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
      {/if}
    </div>

    {#if false}
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
                <div class="bank-balance-amt">
                  <span class="cur">RM</span>{fmt(entry.balance)}
                </div>
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
    {/if}
  </div>
  </div>
</div>

<!-- Organize: a real half-height bottom sheet (position:fixed, slides up
     over the card stack above) rather than the .sheet-page pattern every
     other sheet in this app uses -- that pattern deliberately gave up
     position:fixed (see its own comment) because a nested overflow:auto
     scroller INSIDE a fixed container is what caused the confirmed
     hold-during-bounce freeze on iOS. This panel's list has no such
     scroller in practice (a personal bank list is a handful of rows,
     .organize-list-wrap's overflow-y:auto is a rare-case safety net, not
     something that actually needs to scroll day to day) -- if that ever
     changes, revisit this the same way ManageBanksSheet itself was
     migrated off .sheet. -->
<div
  class="organize-backdrop"
  class:open={organizeOpen}
  role="button"
  tabindex={organizeOpen ? 0 : -1}
  aria-label="Close organize banks"
  onclick={() => (organizeOpen = false)}
  onkeydown={(e) => e.key === 'Enter' && (organizeOpen = false)}
></div>
<div class="organize-sheet" class:open={organizeOpen}>
  <div class="organize-handle"></div>
  <div class="organize-hd">
    <h3>Reorder banks</h3>
    <button class="icon-btn" aria-label="Close" onclick={() => (organizeOpen = false)}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
  </div>
  <p class="hint" style="margin:0 18px 10px;">Drag to set the order banks appear in around the app.</p>
  <div class="organize-list-wrap">
    <div class="sortable-list" use:sortable={{ handle: '.drag-handle', animation: 150, onEnd: handleBankReorder }}>
      {#each banksList as entry (entry.bank.id)}
        <div class="bank-reorder-row">
          <button class="drag-handle" aria-label="Reorder {entry.bank.name}">
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          </button>
          <BankIcon logo={entry.bank.logo} icon={entry.bank.icon} name={entry.bank.name} color={entry.bank.color} />
          <div class="bank-reorder-text">
            <div class="bank-reorder-name">{entry.bank.name}</div>
            <div class="bank-reorder-tag">{bankTag(entry)}</div>
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>

<BankFormSheet
  open={formOpen}
  mode={formMode}
  initial={formInitial}
  {balanceLocked}
  otherBanks={focusedEntry ? banksList.filter((b) => b.bank.id !== focusedEntry.bank.id) : banksList}
  onClose={() => (formOpen = false)}
  onSubmit={handleFormSubmit}
  onDelete={formMode === 'edit' ? handleFormDelete : null}
/>

<style>
  .add-link {
    display: flex; align-items: center; gap: 5px;
    background: var(--panel); border: 1.5px solid var(--stroke-2); border-radius: 99px;
    box-shadow: 2px 2px 0 var(--stroke-2);
    font-size: 13.5px; font-weight: 700; color: var(--gold); padding: 6px 12px 6px 10px;
  }

  /* .sheet-page-body's own min-height now lives globally in app.css (every
     sheet page needs it, for swipeBack.js's full-screen touch target, not
     just this one) -- this just adds the column-flex layout on top, which
     is what lets .stack-wrap grow to fill whatever's left and push the peek
     stack down to the true bottom, like real Wallet, instead of a fixed
     guess-a-margin gap. */
  .sheet-page-body { display: flex; flex-direction: column; }
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
  .stack-wrap:not(.expanded) { margin-bottom: -200px; }

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

  /* Same drag-handle/sortable-list treatment as Settings' Fixed categories/
     Buffer labels -- Svelte scopes styles per-component, so this needs its
     own copy here rather than sharing that one. */
  .drag-handle {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--dim);
    touch-action: none;
    cursor: grab;
  }
  :global(.sortable-list .sortable-ghost) {
    opacity: 0.3;
  }
  :global(.sortable-list .sortable-drag) {
    background: var(--panel-2);
    border-radius: 12px;
    box-shadow: 3px 3px 0 var(--stroke-2);
  }
  .bank-reorder-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 4px;
    border-bottom: 1px solid var(--stroke);
  }
  .sortable-list .bank-reorder-row:last-child {
    border-bottom: none;
  }
  .bank-reorder-text { flex: 1; min-width: 0; }
  .bank-reorder-name { font-size: 13.5px; font-weight: 600; color: var(--hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bank-reorder-tag { font-size: 11px; color: var(--dim); margin-top: 1px; }

  /* ---------- Organize: half-height bottom sheet ---------- */
  .organize-backdrop {
    position: fixed; inset: 0;
    background: rgba(6, 7, 10, 0.6);
    z-index: 70;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.28s ease;
  }
  .organize-backdrop.open { opacity: 1; pointer-events: auto; }
  .organize-sheet {
    position: fixed; left: 0; right: 0; bottom: 0;
    z-index: 71;
    background: var(--ink);
    border: 2px solid var(--stroke-2);
    border-bottom: none;
    border-radius: 24px 24px 0 0;
    box-shadow: 0 -3px 0 var(--stroke-2);
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    transform: translateY(100%);
    transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
    will-change: transform;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  .organize-sheet.open { transform: translateY(0); }
  .organize-handle {
    width: 36px; height: 4px;
    border-radius: 99px;
    background: var(--stroke-2);
    margin: 10px auto 2px;
    flex-shrink: 0;
  }
  .organize-hd {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 18px 4px;
    flex-shrink: 0;
  }
  .organize-hd h3 { font-size: 15.5px; font-weight: 700; margin: 0; }
  .organize-hd .icon-btn { width: 32px; height: 32px; }
  .organize-list-wrap {
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    padding: 0 18px 8px;
    scrollbar-width: none;
  }
  .organize-list-wrap::-webkit-scrollbar { display: none; }
</style>
