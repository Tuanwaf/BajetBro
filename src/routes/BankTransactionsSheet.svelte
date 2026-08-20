<script>
  import { fmt, formatDate, toDatetimeLocalValue, cycleDatetimeBounds } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { currentMonth } from '../lib/stores.js';
  import { banks as bankPreviewStore, moveTransactionsBank, updateTaggedEntry, deleteTaggedEntry } from '../lib/bankPreviewStore.js';
  import { sheetPageCount } from '../lib/viewStore.js';
  import { swipeBack } from '../lib/swipeBack.js';
  import BankIcon from '../lib/components/BankIcon.svelte';
  import DateTimeField from '../lib/components/DateTimeField.svelte';

  let { open, bank, transactions = [], onClose } = $props();

  // See CategoryDetailSheet.svelte's comment -- .sheet-page, registers on
  // sheetPageCount, not openSheetCount.
  $effect(() => {
    if (!open) return;
    sheetPageCount.update((n) => n + 1);
    return () => sheetPageCount.update((n) => n - 1);
  });

  let month = $derived($currentMonth);
  let banksList = $derived($bankPreviewStore);
  // Every editable kind here (category/buffer/reimbursement/
  // additionalIncome/transfer) always lives on the current, still-open
  // month -- no "next cycle" to bound against, same as AddExpenseSheet.
  let dtBounds = $derived(cycleDatetimeBounds(month));
  // Every other bank a wrongly-tagged entry could move to -- moving to the
  // one it's already on would be a no-op.
  let otherBanks = $derived(banksList.filter((b) => b.bank.id !== bank?.id));

  // One "Move" toggle in the header, rather than a button on every row --
  // tapping it turns the list into a multi-select picker (each row gets a
  // circle you can check independently, not exclusive like a real radio
  // group) and reveals a destination-bank bar pinned above the list, not
  // nested under whichever row happens to be selected. Picking a bank there
  // moves everything currently checked in one go. Mutually exclusive with
  // editing a row inline.
  let moveMode = $state(false);
  let selectedIndices = $state([]);
  let editingIdx = $state(null);
  let confirmDeleteIdx = $state(null);
  let editAmt = $state('');
  let editNote = $state('');
  let editDateInput = $state('');

  // Exactly one of tx/extra/entry/transfer is set depending on source.kind --
  // this gets at the underlying object regardless of which.
  function rawEntry(source) {
    return source.tx || source.extra || source.entry || source.transfer;
  }

  // goalAllocation/goalSpend already have their own dedicated edit/delete UI
  // in Goals.svelte's goal detail sheet -- editing them here too would mean
  // two places that can each go stale relative to the other, so this sheet
  // only shows them read-only, for transparency. Move similarly only covers
  // kinds moveTransactionsBank() actually knows how to retag -- a transfer
  // already names two banks explicitly, so "move" isn't a coherent action
  // for it (fix a mistaken transfer via Edit/Delete instead).
  const EDITABLE_KINDS = new Set(['category', 'buffer', 'reimbursement', 'additionalIncome', 'transfer']);
  const MOVABLE_KINDS = new Set(['category', 'buffer', 'reimbursement', 'additionalIncome']);

  function toggleMoveMode() {
    moveMode = !moveMode;
    selectedIndices = [];
    editingIdx = null;
    confirmDeleteIdx = null;
  }
  function toggleSelect(i) {
    selectedIndices = selectedIndices.includes(i) ? selectedIndices.filter((x) => x !== i) : [...selectedIndices, i];
  }
  async function moveSelectedTo(newBankId) {
    if (!month || !selectedIndices.length) return;
    const sources = selectedIndices.map((i) => transactions[i]?.source).filter(Boolean);
    await moveTransactionsBank(month, sources, newBankId);
    showToast(`Moved ${sources.length} ${sources.length === 1 ? 'entry' : 'entries'}`);
    moveMode = false;
    selectedIndices = [];
  }

  function startEdit(i, t) {
    editingIdx = i;
    confirmDeleteIdx = null;
    moveMode = false;
    selectedIndices = [];
    const e = rawEntry(t.source);
    editAmt = String(t.amount);
    editNote = e.note || '';
    editDateInput = toDatetimeLocalValue(new Date(e.date));
  }
  async function commitEdit(t) {
    const amt = parseFloat(editAmt);
    if (!amt) return showToast('Enter an amount first');
    const chosen = new Date(editDateInput);
    if (isNaN(chosen)) return showToast('Pick a valid date and time');
    if (chosen > new Date()) return showToast("Date can't be in the future");
    if (month.startedAt && chosen < new Date(month.startedAt)) {
      return showToast(`Date can't be before ${formatDate(month.startedAt)} — that's when this cycle started`);
    }
    await updateTaggedEntry(month, t.source, { amount: amt, note: editNote.trim(), date: chosen.toISOString() });
    editingIdx = null;
    showToast('Updated');
  }
  async function removeEntry(t) {
    await deleteTaggedEntry(month, t.source);
    confirmDeleteIdx = null;
    showToast('Removed');
  }

  $effect(() => {
    if (!open) {
      moveMode = false;
      selectedIndices = [];
      editingIdx = null;
      confirmDeleteIdx = null;
    }
  });
</script>

<div class="sheet-page" class:open use:swipeBack={onClose}>
  <div class="sheet-page-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>{bank?.name ?? 'Transactions'}</h2>
    {#if otherBanks.length}
      <button class="move-toggle" class:active={moveMode} onclick={toggleMoveMode}>
        {#if !moveMode}
          <svg viewBox="0 0 24 24" fill="none" width="13" height="13"><path d="M3 8h14m0 0-4-4m4 4-4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 16H7m0 0 4-4m-4 4 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {/if}
        {moveMode ? 'Cancel' : 'Move'}
      </button>
    {:else}
      <span style="width:38px;"></span>
    {/if}
  </div>
  <div class="sheet-page-body">
    {#if moveMode}
      <div class="move-target-bar">
        <p class="hint" style="margin:0 0 6px 4px;">
          {selectedIndices.length ? `Move ${selectedIndices.length} selected to:` : 'Check one or more entries below, then pick where to move them:'}
        </p>
        <div class="chip-scroll">
          {#each otherBanks as b (b.bank.id)}
            <button class="chip" disabled={!selectedIndices.length} onclick={() => moveSelectedTo(b.bank.id)}>
              <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} size={18} />
              {b.bank.name}
            </button>
          {/each}
        </div>
      </div>
    {/if}
    <div class="card">
      {#each transactions as t, i}
        <div class="tx-entry">
          {#if editingIdx === i}
            <div class="tx-edit">
              <input class="note-input num" bind:value={editAmt} inputmode="decimal" placeholder="0.00" />
              <input class="note-input" bind:value={editNote} placeholder="Note (optional)" />
              <DateTimeField bind:value={editDateInput} min={dtBounds.min} max={dtBounds.max} />
              <div style="display:flex; gap:8px;">
                <button class="io-btn" style="flex:1;" onclick={() => (editingIdx = null)}>Cancel</button>
                <button class="save-btn" style="flex:1; margin-top:0;" onclick={() => commitEdit(t)}>Save</button>
              </div>
            </div>
          {:else if moveMode && t.source && MOVABLE_KINDS.has(t.source.kind)}
            <div
              class="tx-row select-row"
              role="button"
              tabindex="0"
              onclick={() => toggleSelect(i)}
              onkeydown={(e) => e.key === 'Enter' && toggleSelect(i)}
            >
              <span class="radio" class:checked={selectedIndices.includes(i)}>
                {#if selectedIndices.includes(i)}<span class="radio-dot"></span>{/if}
              </span>
              <span class="dot" style="background:{t.color}"></span>
              <div>
                <div class="tx-note-main">{t.note}</div>
                <div class="tx-date">{formatDate(t.date)}</div>
              </div>
              <span class="num tx-amt" style="color:{t.income ? 'var(--good)' : 'var(--red)'};">{t.income ? '+' : '−'}RM {fmt(t.amount)}</span>
            </div>
          {:else if moveMode}
            <!-- Not movable (transfer/goal entry) -- shown but not
                 selectable, so it's still visible while picking a
                 destination for everything else. -->
            <div class="tx-row" style="opacity:0.5;">
              <span class="dot" style="background:{t.color}"></span>
              <div>
                <div class="tx-note-main">{t.note}</div>
                <div class="tx-date">{formatDate(t.date)}</div>
              </div>
              <span class="num tx-amt" style="color:{t.income ? 'var(--good)' : 'var(--red)'};">{t.income ? '+' : '−'}RM {fmt(t.amount)}</span>
            </div>
          {:else}
            <!-- Same row shape as CategoryDetailSheet/BufferDetailSheet/
                 ReimbursementsSheet: note+date, amount, then Edit/Delete as
                 plain .icon-btn -- app.css already colors those yellow/red
                 by their aria-label (see the "Edit"/"Delete" prefix rules),
                 so this needed no custom styling to be on-theme. -->
            <div class="tx-row">
              <span class="dot" style="background:{t.color}"></span>
              <div>
                <div class="tx-note-main">{t.note}</div>
                <div class="tx-date">{formatDate(t.date)}</div>
              </div>
              <span class="num tx-amt" style="color:{t.income ? 'var(--good)' : 'var(--red)'};">{t.income ? '+' : '−'}RM {fmt(t.amount)}</span>
              {#if t.source && EDITABLE_KINDS.has(t.source.kind)}
                <button class="icon-btn small" aria-label="Edit entry" onclick={() => startEdit(i, t)}>
                  <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
                </button>
                <button class="icon-btn small" aria-label="Delete entry" onclick={() => (confirmDeleteIdx = i)}>
                  <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              {/if}
            </div>
            {#if confirmDeleteIdx === i}
              <div class="del-confirm">
                <span>Delete this RM {fmt(t.amount)} entry?</span>
                <div style="display:flex; gap:8px; margin-top:8px;">
                  <button class="io-btn" style="flex:1;" onclick={() => (confirmDeleteIdx = null)}>Cancel</button>
                  <button class="save-btn danger" style="flex:1; margin-top:0;" onclick={() => removeEntry(t)}>Delete</button>
                </div>
              </div>
            {/if}
          {/if}
        </div>
      {:else}
        <p class="hint" style="margin:2px 0;">No transactions yet on this bank.</p>
      {/each}
    </div>
    <p class="hint">Editing or moving an entry only changes its amount/note or which bank it's tracked against — it stays under the same category and keeps this month's Commitments in sync.</p>
  </div>
</div>

<style>
  .tx-entry { border-bottom: 1px solid var(--stroke); }
  .tx-entry:last-child { border-bottom: none; }

  .tx-row { display: flex; align-items: center; gap: 10px; padding: 12px 4px; }
  .tx-row > div { flex: 1; min-width: 0; }
  .tx-note-main { font-size: 13.5px; font-weight: 600; color: var(--hi); }
  .tx-date { font-size: 11px; color: var(--dim); margin-top: 2px; }
  .tx-amt { font-weight: 700; flex-shrink: 0; }
  .icon-btn.small { width: 28px; height: 28px; }
  .icon-btn.small + .icon-btn.small { margin-left: 2px; }

  /* Same pill shape the per-row Move button used before this became a
     single header toggle -- icon + label while off, a plain muted label
     while on (already mid-action, nothing left to announce). */
  .move-toggle {
    display: flex; align-items: center; gap: 4px;
    background: var(--panel); border: 1.5px solid var(--stroke-2); border-radius: 99px;
    padding: 5px 10px 5px 9px;
    font-size: 12px; font-weight: 700; color: var(--gold);
    box-shadow: 2px 2px 0 var(--stroke-2);
  }
  .move-toggle.active { color: var(--dim); padding: 5px 10px; }

  .select-row { cursor: pointer; }
  .radio {
    width: 20px; height: 20px; border-radius: 50%; flex-shrink: 0;
    border: 2px solid var(--stroke-2);
    display: flex; align-items: center; justify-content: center;
  }
  .radio.checked { border-color: var(--gold); }
  .radio-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--gold); }

  /* Destination bar lives above the list (not nested per-row) so it stays
     put while checking multiple entries -- same swipeable-line treatment
     BankFormFields/AddExpenseSheet already use for their own bank pickers. */
  .move-target-bar { padding: 2px 0 10px; }
  .chip-scroll {
    display: flex; gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 2px 2px 4px;
  }
  .chip-scroll::-webkit-scrollbar { display: none; }
  .chip-scroll .chip { flex-shrink: 0; }
  .chip-scroll .chip:disabled { opacity: 0.4; }

  .tx-edit {
    padding: 10px 4px 14px;
    display: flex; flex-direction: column; gap: 8px;
  }
</style>
