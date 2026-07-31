<script>
  import { currentMonth } from '../lib/stores.js';
  import { round2 } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { ADHOC_COLOR } from '../lib/constants.js';
  import db from '../lib/db.js';

  let { open, label, onClose } = $props();

  let month = $derived($currentMonth);

  // Entries under this label, each paired with its index in month.extras so
  // edits/deletes target the right row (index-based, not object identity).
  let entries = $derived.by(() => {
    const ex = month?.extras || [];
    return ex
      .map((e, idx) => ({ e, idx }))
      .filter((x) => x.e.name === label)
      .sort((a, b) => new Date(b.e.date || 0) - new Date(a.e.date || 0));
  });
  let total = $derived(round2(entries.reduce((s, x) => s + (x.e.actual || 0), 0)));

  let editingIdx = $state(null);
  let editAmt = $state('');
  let editNote = $state('');
  let editLabel = $state('');
  let editPaid = $state('');

  // extra.actual is stored NET (full paid - paid back); reimbursed tracks the
  // payback so the full amount = actual + reimbursed.
  const fullOf = (e) => round2((e.actual || 0) + (e.reimbursed || 0));

  function startEdit(x) {
    editingIdx = x.idx;
    editAmt = String(fullOf(x.e));
    editNote = x.e.note || '';
    editLabel = x.e.name;
    editPaid = x.e.reimbursed ? String(x.e.reimbursed) : '';
  }
  function cancelEdit() {
    editingIdx = null;
  }
  async function saveEdit() {
    const amt = parseFloat(editAmt);
    if (!amt) return showToast('Enter an amount first');
    const paid = Math.min(Math.max(parseFloat(editPaid) || 0, 0), amt);
    const name = editLabel.trim() || label;
    const extras = month.extras.map((e, i) =>
      i === editingIdx ? { ...e, actual: round2(amt - paid), reimbursed: paid || undefined, note: editNote.trim() || undefined, name } : e
    );
    await db.months.update(month.key, { extras });
    editingIdx = null;
    if (name !== label) showToast(`Moved to ${name}`);
  }
  async function deleteEntry(x) {
    const extras = month.extras.filter((_, i) => i !== x.idx);
    await db.months.update(month.key, { extras });
    showToast('Entry deleted');
    if (extras.filter((e) => e.name === label).length === 0) onClose();
  }

  function formatDate(iso) {
    if (!iso) return 'No date';
    const d = new Date(iso);
    return isNaN(d) ? 'No date' : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function formatTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="sheet" class:open>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>{label ?? ''}</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-body">
    <div class="card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="dot" style="background:{ADHOC_COLOR}"></span>
        <span style="font-size:13.5px; color:var(--lo);">Ad-hoc · {label} total</span>
      </div>
      <span class="num" style="font-weight:700;">RM {fmt(total)}</span>
    </div>

    <div class="field-lbl" style="margin-top:0;">Entries · tap ✎ to fix</div>
    <div class="card">
      {#each entries as x (x.idx)}
        {#if editingIdx === x.idx}
          <div class="tx-edit">
            <input class="note-input num" bind:value={editAmt} inputmode="decimal" placeholder="0.00" />
            <input class="note-input" bind:value={editNote} placeholder="Note (e.g. Shopee, Tiktok)" />
            <div class="mini-lbl">Paid back to you (bill split / pay first)</div>
            <input class="note-input num" bind:value={editPaid} inputmode="decimal" placeholder="0.00" />
            <div class="mini-lbl">Label</div>
            <input class="note-input" bind:value={editLabel} placeholder="Ad-hoc label" />
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button class="io-btn" style="flex:1;" onclick={cancelEdit}>Cancel</button>
              <button class="save-btn" style="flex:1; margin-top:0;" onclick={saveEdit}>Save</button>
            </div>
          </div>
        {:else}
          <div class="tx-row">
            <div>
              <div class="tx-date">{formatDate(x.e.date)}{formatTime(x.e.date) ? ` · ${formatTime(x.e.date)}` : ''}</div>
              {#if x.e.note}<div class="tx-note">{x.e.note}</div>{/if}
              {#if x.e.reimbursed}<div class="tx-back">−RM {fmt(x.e.reimbursed)} paid back · net RM {fmt(x.e.actual)}</div>{/if}
            </div>
            <span class="num tx-amt">RM {fmt(fullOf(x.e))}</span>
            <button class="icon-btn small" aria-label="Edit entry" onclick={() => startEdit(x)}>
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </button>
            <button class="icon-btn small" aria-label="Delete entry" onclick={() => deleteEntry(x)}>
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        {/if}
      {:else}
        <p class="hint" style="margin:2px 0;">No entries under this label.</p>
      {/each}
    </div>
    <p class="hint">Same label, split into individual entries — change the Label field to move one under a different Ad-hoc name.</p>
  </div>
</div>

<style>
  .tx-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 4px;
    border-bottom: 1px solid var(--stroke);
  }
  .tx-row:last-child {
    border-bottom: none;
  }
  .tx-row > div:first-child {
    flex: 1;
    min-width: 0;
  }
  .tx-date {
    font-size: 13px;
    color: var(--hi);
    font-family: var(--mono);
  }
  .tx-note {
    font-size: 11.5px;
    color: var(--dim);
    margin-top: 2px;
  }
  .tx-back {
    font-size: 11.5px;
    color: var(--good);
    font-family: var(--mono);
    margin-top: 3px;
  }
  .tx-amt {
    font-weight: 600;
  }
  .icon-btn.small {
    width: 28px;
    height: 28px;
  }
  .icon-btn.small + .icon-btn.small {
    margin-left: 6px;
  }
  .tx-edit {
    padding: 10px 0;
    border-bottom: 1px solid var(--stroke);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .tx-edit:last-child {
    border-bottom: none;
  }
  .mini-lbl {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--dim);
    margin-top: 2px;
  }
</style>
