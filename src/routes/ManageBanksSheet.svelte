<script>
  import { flip } from 'svelte/animate';
  import { quintOut } from 'svelte/easing';
  import { fmt } from '../lib/format.js';
  import { GOAL_COLORS } from '../lib/constants.js';
  import { showToast } from '../lib/toast.js';
  import { banks as bankPreviewStore, focusedBankIndex, addBank, renameBank, recolorBank, deleteBank } from '../lib/bankPreviewStore.js';

  let { open, onClose } = $props();

  let banksList = $derived($bankPreviewStore);
  let focusedIndex = $derived($focusedBankIndex);
  let focusedEntry = $derived(banksList[focusedIndex] ?? banksList[0]);

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

  let editing = $state(false);
  let editName = $state('');

  let adding = $state(false);
  let newBankName = $state('');

  // Real Apple Wallet doesn't show the full overlapping stack by default --
  // only the front card plus a peek of the next one behind it. Tapping that
  // peek reveals the full, individually-tappable stack; picking a card from
  // it (or tapping the front card again) collapses back down.
  let stackExpanded = $state(false);

  // The focused card renders separately at the top (see markup) with full
  // detail. This list is just the stack underneath it: collapsed, exactly
  // one peek card (orderedBanks[1]); expanded, everything -- including the
  // currently-focused bank, which becomes a plain member of the browsing
  // stack like real Wallet does, instead of keeping its detail view (that
  // inconsistency was the original complaint).
  let visibleBanks = $derived(
    stackExpanded ? orderedBanks : orderedBanks.slice(1, 2)
  );

  function focusById(id) {
    const i = banksList.findIndex((b) => b.bank.id === id);
    if (i === -1) return;
    focusedBankIndex.set(i);
    editing = false;
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

  function startEdit() {
    editName = focusedEntry.bank.name;
    editing = true;
  }

  function commitRename() {
    const name = editName.trim();
    if (!name) return showToast('Enter a name first');
    renameBank(focusedIndex, name);
    editing = false;
  }

  function pickColor(color) {
    recolorBank(focusedIndex, color);
  }

  function removeFocused() {
    if (banksList.length <= 1) return showToast("You need at least one bank");
    deleteBank(focusedIndex);
    editing = false;
    showToast('Removed');
  }

  function commitAdd() {
    const name = newBankName.trim();
    if (!name) return showToast('Enter a name first');
    addBank(name);
    newBankName = '';
    adding = false;
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
    <button class="add-link" onclick={() => (adding = !adding)}>{adding ? 'Cancel' : 'Add'}</button>
  </div>
  <div class="sheet-body">
    <div class="sheet-body-top">
      <p class="hint" style="margin:0 4px 14px;">Tap a card to make it your main focus on Home. Preview — mock data, local only.</p>

      {#if adding}
        <div class="card" style="margin-bottom:14px;">
          <div class="field-lbl" style="margin-top:0;">New bank or e-wallet</div>
          <input class="note-input" placeholder="e.g. Bank Islam" bind:value={newBankName} onkeydown={(e) => e.key === 'Enter' && commitAdd()} />
          <button class="save-btn" onclick={commitAdd}>Add bank</button>
        </div>
      {/if}

      {#if !stackExpanded && focusedEntry}
        <div class="stack-card focused" style="border-color:{focusedEntry.bank.color}; box-shadow:5px 5px 0 {focusedEntry.bank.color};">
          <button class="stack-card-top" onclick={() => (stackExpanded = true)}>
            <span class="bank-logo" style="background:{focusedEntry.bank.color}">{focusedEntry.bank.name[0]}</span>
            <div class="bank-id-text">
              <div class="bank-name">{focusedEntry.bank.name}</div>
              <div class="bank-tag">Main bank</div>
            </div>
            <div class="bank-brand">BAJETBRO</div>
          </button>
          <div class="stack-detail">
            <button class="edit-fab" aria-label="Edit bank" onclick={startEdit}>
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </button>
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
        </div>
      {/if}
    </div>

    <!-- Collapsed: just the single peek, pinned to the bottom of the sheet
         (real Wallet leaves a big empty gap under the front card, not a
         small margin). Expanded: the full browsing stack, including the
         card that was just focused above -- it becomes a plain member of
         the stack like everything else, which is what real Wallet does;
         normal top-down flow here, not bottom-pinned, since it can be
         longer than the screen. -->
    <div class="stack-wrap" class:expanded={stackExpanded}>
      <div class="bank-stack">
        {#each visibleBanks as entry, i (entry.bank.id)}
          <div
            class="stack-card"
            class:peek={!stackExpanded}
            style="border-color:{entry.bank.color}; box-shadow:5px 5px 0 {entry.bank.color}; z-index:{orderedBanks.length - i};"
            animate:flip={{ duration: 380, easing: quintOut }}
          >
            {#if !stackExpanded && orderedBanks.length > 2}
              <span class="peek-edge" style="background:{orderedBanks[2].bank.color}"></span>
            {/if}
            <button class="stack-card-top" onclick={() => onCardTap(entry)}>
              <span class="bank-logo" style="background:{entry.bank.color}">{entry.bank.name[0]}</span>
              <div class="bank-id-text">
                <div class="bank-name">{entry.bank.name}</div>
                <div class="bank-tag">{entry.bank.id === banksList[0]?.bank.id ? 'Main bank' : 'Added'}</div>
              </div>
              <div class="bank-brand">BAJETBRO</div>
            </button>
          </div>
        {/each}
      </div>
    </div>

    {#if editing}
      <div class="card" style="margin-top:14px;">
        <div class="field-lbl" style="margin-top:0;">Rename</div>
        <input class="note-input" bind:value={editName} onkeydown={(e) => e.key === 'Enter' && commitRename()} />
        <div class="field-lbl">Color</div>
        <div class="chip-row">
          {#each GOAL_COLORS as c}
            <button class="color-swatch" style="background:{c};" class:selected={focusedEntry.bank.color === c} aria-label="Pick color" onclick={() => pickColor(c)}></button>
          {/each}
        </div>
        <div style="display:flex; gap:8px; margin-top:14px;">
          <button class="io-btn" style="flex:1;" onclick={() => (editing = false)}>Cancel</button>
          <button class="save-btn" style="flex:1; margin-top:0;" onclick={commitRename}>Save</button>
        </div>
        <button class="io-btn danger" style="margin-top:10px;" onclick={removeFocused}>Remove this bank</button>
      </div>
    {/if}
  </div>
</div>

<style>
  .add-link { background: none; border: none; font-size: 15px; font-weight: 700; color: var(--gold); padding: 4px; }

  /* .sheet-body is flex:1 with overflow-y:auto (app.css) -- turning it into
     a column flex container here lets .stack-wrap grow to fill whatever's
     left and push the peek stack down to the true bottom of the visible
     sheet, like real Wallet, instead of a fixed guess-a-margin gap. */
  .sheet-body { display: flex; flex-direction: column; }
  .sheet-body-top { flex-shrink: 0; }
  .stack-wrap {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }
  .stack-wrap.expanded { justify-content: flex-start; }

  .bank-stack { display: flex; flex-direction: column; }

  .stack-card {
    background: var(--panel);
    border: 2px solid var(--stroke-2);
    border-radius: 22px;
    position: relative;
    /* Collapsed cards overlap the next one below by this much. Learned the
       hard way (2026-08-07) that this must leave MOST of a collapsed card's
       ~71px height exposed -- too much overlap covers the card's own tap
       target with whatever's stacked in front of it. */
    margin-bottom: -25px;
    transition: margin-bottom 0.38s;
  }
  .stack-card.focused { margin-bottom: 14px; }
  /* The single peek card in collapsed state: same card, just visually
     capped so only its header row reads -- reusing the exact same markup
     as the focused card (rather than a separately-styled compact summary)
     is what makes it actually look like a real card peeking through. */
  .stack-card.peek { max-height: 78px; overflow: hidden; }

  .peek-edge {
    display: block;
    position: absolute;
    top: -10px; left: 10px; right: 10px;
    height: 10px;
    border-radius: 10px 10px 0 0;
    opacity: 0.55;
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
  .bank-logo {
    width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: var(--accent-ink); font-family: var(--display); font-weight: 800; font-size: 15px;
    border: 1.5px solid var(--stroke-2);
  }
  .bank-id-text { flex: 1; min-width: 0; }
  .bank-name { font-weight: 700; font-size: 14.5px; }
  .bank-tag { font-size: 10.5px; color: var(--dim); font-weight: 600; margin-top: 1px; }
  .bank-brand {
    font-family: var(--display); font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em;
    color: var(--dim); text-transform: uppercase; flex-shrink: 0;
  }

  .stack-detail { padding: 0 18px 18px; }
  .edit-fab {
    position: absolute; top: 14px; right: 14px;
    width: 30px; height: 30px; border-radius: 50%;
    background: var(--yellow); border: 2px solid var(--stroke-2); box-shadow: 2px 2px 0 var(--stroke-2);
    color: var(--stroke-2); display: flex; align-items: center; justify-content: center;
  }
  .bank-balance-lbl { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dim); }
  .bank-balance-amt {
    font-family: var(--mono); font-variant-numeric: tabular-nums;
    font-size: 32px; font-weight: 700; letter-spacing: -0.01em;
    margin: 3px 0 14px;
  }
  .bank-balance-amt .cur { font-size: 15px; color: var(--dim); font-weight: 600; margin-right: 3px; }
  .bank-stats-row { display: flex; justify-content: space-between; align-items: flex-start; }
  .bank-stat.right { text-align: right; }
  .bank-stat .k { font-size: 10.5px; color: var(--dim); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .bank-stat .v { font-size: 14px; font-weight: 700; margin-top: 3px; }

  .color-swatch {
    width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--stroke-2);
  }
  .color-swatch.selected { outline: 2.5px solid var(--stroke-2); outline-offset: 2px; }
  .io-btn.danger { background: var(--red-dim); color: var(--red); border-color: var(--red); font-weight: 700; }
</style>
