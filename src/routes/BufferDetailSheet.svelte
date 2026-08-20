<script>
  import { currentMonth, template, hutangPots } from '../lib/stores.js';
  import { round2 } from '../lib/calc.js';
  import { fmt, toDatetimeLocalValue, cycleDatetimeBounds } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { BUFFER_COLOR, BUFFER_LABEL_PRESETS } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { banks as bankPreviewStore, adjustBankBalance, reconcileGoalReserve } from '../lib/bankPreviewStore.js';
  import { sheetPageCount } from '../lib/viewStore.js';
  import { swipeBack } from '../lib/swipeBack.js';
  import DateTimeField from '../lib/components/DateTimeField.svelte';

  let { open, label, onClose } = $props();

  // See CategoryDetailSheet.svelte's comment -- .sheet-page, registers on
  // sheetPageCount, not openSheetCount.
  $effect(() => {
    if (!open) return;
    sheetPageCount.update((n) => n + 1);
    return () => sheetPageCount.update((n) => n - 1);
  });

  let month = $derived($currentMonth);
  let tmpl = $derived($template);
  let pots = $derived($hutangPots ?? []);
  // Same source AddExpenseSheet/CategoryDetailSheet use -- picking a
  // different Buffer label here offers the exact same presets as adding a
  // fresh entry would, instead of a free-text field.
  let bufferLabels = $derived(tmpl?.bufferLabels ?? BUFFER_LABEL_PRESETS);
  let banksList = $derived($bankPreviewStore);
  function bankName(id) {
    return banksList.find((b) => b.bank.id === id)?.bank.name;
  }
  // This sheet only ever shows the current, still-open month's own entries
  // -- no "next cycle" to bound against, same as AddExpenseSheet.
  let dtBounds = $derived(cycleDatetimeBounds(month));

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
  let confirmDeleteIdx = $state(null);
  let editAmt = $state('');
  let editNote = $state('');
  let editDest = $state('buffer'); // 'buffer', or a fixed category key
  let editBufferLabel = $state(null); // when editDest === 'buffer': a preset label or 'custom'
  let editCustomBufferLabel = $state('');
  let editPaid = $state('');
  let editPaidAbsolute = $state(false); // true once "edit total" or "clear" is tapped -- editPaid becomes the new total instead of an amount to add
  let editDateInput = $state('');

  // extra.actual is stored NET (full paid - paid back); reimbursed tracks the
  // payback so the full amount = actual + reimbursed.
  const fullOf = (e) => round2((e.actual || 0) + (e.reimbursed || 0));

  function startEdit(x) {
    editingIdx = x.idx;
    editAmt = String(fullOf(x.e));
    editNote = x.e.note || '';
    editDest = 'buffer';
    editBufferLabel = bufferLabels.includes(x.e.name) ? x.e.name : 'custom';
    editCustomBufferLabel = bufferLabels.includes(x.e.name) ? '' : x.e.name;
    editPaid = ''; // amount to ADD to e.reimbursed, not the new total
    editPaidAbsolute = false;
    editDateInput = toDatetimeLocalValue(new Date(x.e.date));
  }
  function cancelEdit() {
    editingIdx = null;
  }
  function editPaidTotal(e) {
    editPaidAbsolute = true;
    editPaid = e.reimbursed ? String(e.reimbursed) : '0';
  }
  function clearPaidTotal() {
    editPaidAbsolute = true;
    editPaid = '0';
  }
  async function writeCategories(newCats) {
    await db.months.update(month.key, { categories: newCats });
  }

  // Keep this month's Saving pot in step -- see CategoryDetailSheet.svelte's
  // copy of this same helper for why (its `initial` feeds the shared Goals
  // pool). Only relevant here when an entry moves INTO the Saving category.
  async function adjustPot(delta) {
    if (!delta) return;
    const p = pots.find((x) => x.month === month.key);
    if (p) {
      const ni = round2(p.initial + delta);
      if (ni > 0.005) await db.hutangPots.update(month.key, { initial: ni });
      else await db.hutangPots.delete(month.key);
    } else if (delta > 0) {
      await db.hutangPots.put({ month: month.key, initial: round2(delta) });
    }
  }

  async function saveEdit() {
    const amt = parseFloat(editAmt);
    if (!amt) return showToast('Enter an amount first');
    const chosen = new Date(editDateInput);
    if (isNaN(chosen)) return showToast('Pick a valid date and time');
    if (chosen > new Date()) return showToast("Date can't be in the future");
    if (month.startedAt && chosen < new Date(month.startedAt)) {
      return showToast(`Date can't be before ${formatDate(month.startedAt)} — that's when this cycle started`);
    }
    const editDate = chosen.toISOString();
    const paidInput = parseFloat(editPaid) || 0;
    const original = month.extras[editingIdx];
    const paid = editPaidAbsolute
      ? Math.min(Math.max(paidInput, 0), amt) // direct override of the total
      : Math.min(Math.max((original.reimbursed || 0) + paidInput, 0), amt); // stacks onto what's already recorded
    const note = editNote.trim();
    const newNet = round2(amt - paid);
    const destKey = editDest;

    if (destKey !== 'buffer') {
      // Leaving Buffer entirely for a fixed category.
      const extras = month.extras.filter((_, i) => i !== editingIdx);
      await db.months.update(month.key, { extras });
      const newTx = { amount: amt, date: editDate, note: note || undefined, reimbursed: paid || undefined, bankId: original.bankId };
      let cats = month.categories.map((c) =>
        c.key === destKey ? { ...c, actual: round2(c.actual + newNet), transactions: [...(c.transactions || []), newTx] } : c
      );
      await writeCategories(cats);
      if (destKey === 'saving') await adjustPot(newNet);
      // Compare NET debits (original.actual is already stored net -- see
      // fullOf's comment above), not gross amounts -- a change in how much
      // of this entry is paid back moves real money back into the bank
      // too, not just the budget's actual figure.
      if (original.bankId) await adjustBankBalance(original.bankId, round2((original.actual || 0) - newNet));
      if (original.bankId) {
        const consumption = await reconcileGoalReserve(original.bankId, original.reserveConsumption);
        if (consumption.length || original.reserveConsumption?.length) {
          cats = cats.map((c) =>
            c.key === destKey ? { ...c, transactions: c.transactions.map((t) => (t === newTx ? { ...t, reserveConsumption: consumption.length ? consumption : undefined } : t)) } : c
          );
          await writeCategories(cats);
        }
      }
      const destName = month.categories.find((c) => c.key === destKey)?.name ?? '';
      showToast(`Moved to ${destName}`);
      editingIdx = null;
      if (extras.filter((e) => e.name === label).length === 0) onClose();
      return;
    }

    const newLabel = editBufferLabel === 'custom' ? editCustomBufferLabel.trim() || 'Misc' : editBufferLabel || label;
    let extras = month.extras.map((e, i) =>
      i === editingIdx ? { ...e, actual: newNet, reimbursed: paid || undefined, note: note || undefined, name: newLabel, date: editDate } : e
    );
    await db.months.update(month.key, { extras });
    // Compare NET debits, not gross amounts -- see the branch above for why.
    if (original.bankId) await adjustBankBalance(original.bankId, round2((original.actual || 0) - newNet));
    // Re-derive this entry's effect on a goal's reserve against its NEW
    // amount (see AddExpenseSheet's overspend warning for how it first got
    // there) -- undoes whatever the OLD amount had consumed, then consumes
    // fresh if the new amount still dips in.
    if (original.bankId) {
      const consumption = await reconcileGoalReserve(original.bankId, original.reserveConsumption);
      if (consumption.length || original.reserveConsumption?.length) {
        extras = extras.map((e, i) => (i === editingIdx ? { ...e, reserveConsumption: consumption.length ? consumption : undefined } : e));
        await db.months.update(month.key, { extras });
      }
    }
    // A new custom label becomes a permanent quick-pick chip, same as
    // AddExpenseSheet does when one is typed there.
    if (editBufferLabel === 'custom' && newLabel && !bufferLabels.includes(newLabel)) {
      await db.template.put({ ...tmpl, bufferLabels: [...bufferLabels, newLabel] });
    }
    editingIdx = null;
    if (newLabel !== label) {
      showToast(`Moved to ${newLabel}`);
      if (extras.filter((e) => e.name === label).length === 0) onClose();
    }
  }
  async function deleteEntry(x) {
    const extras = month.extras.filter((_, i) => i !== x.idx);
    await db.months.update(month.key, { extras });
    // Only the still-outstanding net debit (x.e.actual), not fullOf(x.e) --
    // any already-reimbursed portion was credited back to the bank at the
    // time it was marked paid back, so re-crediting the full gross amount
    // here would pay that slice back twice.
    if (x.e.bankId) await adjustBankBalance(x.e.bankId, x.e.actual || 0);
    // Give back whatever this entry had eaten into a goal's reserve --
    // it's not spending anymore once the entry itself is gone.
    if (x.e.bankId) await reconcileGoalReserve(x.e.bankId, x.e.reserveConsumption);
    confirmDeleteIdx = null;
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

<div class="sheet-page" class:open use:swipeBack={onClose}>
  <div class="sheet-page-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>{label ?? ''}</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-page-body">
    <div class="card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; border-color: {BUFFER_COLOR}; box-shadow: 4px 4px 0 {BUFFER_COLOR};">
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="dot" style="background:{BUFFER_COLOR}"></span>
        <span style="font-size:13.5px; color:var(--lo);">Buffer · {label} total</span>
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
            <div class="mini-lbl">Date & time</div>
            <DateTimeField bind:value={editDateInput} min={dtBounds.min} max={dtBounds.max} />
            <div class="mini-lbl paid-hd">
              <span>Paid back to you (bill split / pay first)</span>
              {#if x.e.reimbursed}
                <span class="paid-existing">
                  already RM {fmt(x.e.reimbursed)}
                  <button class="icon-btn tiny" aria-label="Edit paid-back total" onclick={() => editPaidTotal(x.e)}>
                    <svg viewBox="0 0 24 24" fill="none" width="11" height="11"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
                  </button>
                  <button class="icon-btn tiny" aria-label="Clear paid-back amount" onclick={clearPaidTotal}>
                    <svg viewBox="0 0 24 24" fill="none" width="11" height="11"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </span>
              {/if}
            </div>
            <input class="note-input num" bind:value={editPaid} inputmode="decimal" placeholder={editPaidAbsolute ? 'New total, e.g. 13.50' : x.e.reimbursed ? 'Add more, e.g. 1.00' : '0.00'} />
            {#if editPaidAbsolute}<p class="hint-tiny">Editing the total directly — this replaces the RM {fmt(x.e.reimbursed || 0)} already recorded.</p>{/if}
            <div class="mini-lbl">Move to</div>
            <div class="chip-grid">
              <button class="chip ghost" class:selected={editDest === 'buffer'} style={editDest === 'buffer' ? `color:${BUFFER_COLOR}` : ''} onclick={() => (editDest = 'buffer')}>
                <span class="dot" style="background:{BUFFER_COLOR}"></span>Buffer
              </button>
              {#each month.categories as c (c.key)}
                <button class="chip ghost" class:selected={editDest === c.key} style={editDest === c.key ? `color:${c.color}` : ''} onclick={() => (editDest = c.key)}>
                  <span class="dot" style="background:{c.color}"></span>{c.name}
                </button>
              {/each}
            </div>
            {#if editDest === 'buffer'}
              <div class="mini-lbl">Buffer label</div>
              <div class="chip-grid">
                {#each bufferLabels as lbl}
                  <button class="chip ghost" class:selected={editBufferLabel === lbl} style={editBufferLabel === lbl ? `color:${BUFFER_COLOR}` : ''} onclick={() => (editBufferLabel = lbl)}>{lbl}</button>
                {/each}
                <button class="chip ghost" class:selected={editBufferLabel === 'custom'} style={editBufferLabel === 'custom' ? `color:${BUFFER_COLOR}` : ''} onclick={() => (editBufferLabel = 'custom')}>+ Custom</button>
              </div>
              {#if editBufferLabel === 'custom'}
                <input class="note-input" placeholder="Type your own label…" bind:value={editCustomBufferLabel} />
              {/if}
            {/if}
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
              {#if x.e.bankId && bankName(x.e.bankId)}<div class="tx-bank">via {bankName(x.e.bankId)}</div>{/if}
              {#if x.e.reimbursed}<div class="tx-back">−RM {fmt(x.e.reimbursed)} paid back · net RM {fmt(x.e.actual)}</div>{/if}
            </div>
            <span class="num tx-amt">RM {fmt(fullOf(x.e))}</span>
            <button class="icon-btn small" aria-label="Edit entry" onclick={() => startEdit(x)}>
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </button>
            <button class="icon-btn small" aria-label="Delete entry" onclick={() => (confirmDeleteIdx = x.idx)}>
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
          {#if confirmDeleteIdx === x.idx}
            <div class="del-confirm">
              <span>Delete this RM {fmt(fullOf(x.e))} entry?</span>
              <div style="display:flex; gap:8px; margin-top:8px;">
                <button class="io-btn" style="flex:1;" onclick={() => (confirmDeleteIdx = null)}>Cancel</button>
                <button class="save-btn danger" style="flex:1; margin-top:0;" onclick={() => deleteEntry(x)}>Delete</button>
              </div>
            </div>
          {/if}
        {/if}
      {:else}
        <p class="hint" style="margin:2px 0;">No entries under this label.</p>
      {/each}
    </div>
    <p class="hint">Same label, split into individual entries — tap ✎ and use "Move to" to shift one under a different Buffer label or a fixed category instead.</p>
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
  .tx-bank {
    font-size: 10.5px;
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
  .paid-hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .paid-existing {
    display: flex;
    align-items: center;
    gap: 4px;
    text-transform: none;
    font-weight: 600;
    color: var(--good);
    flex-shrink: 0;
  }
  .icon-btn.tiny {
    width: 20px;
    height: 20px;
  }
  .hint-tiny {
    font-size: 10.5px;
    color: var(--dim);
    margin: -2px 0 0;
  }
</style>
