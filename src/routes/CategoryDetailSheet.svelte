<script>
  import { currentMonth, template, hutangPots } from '../lib/stores.js';
  import { round2 } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import db from '../lib/db.js';

  let { open, category, onClose } = $props();

  let month = $derived($currentMonth);
  let tmpl = $derived($template);
  let pots = $derived($hutangPots ?? []);

  let transactions = $derived.by(() => {
    const list = category?.transactions || [];
    return [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
  });

  // Track the row being edited by its index in the sorted list. (Storing the
  // tx object itself fails: Svelte 5 wraps a $state object in a reactive proxy,
  // so `editingTx === tx` is never true against the raw array element.)
  let editingIdx = $state(null);
  let editAmt = $state('');
  let editNote = $state('');
  let editDest = $state(null); // destination category key
  let editPaid = $state(''); // amount paid back to you (reimbursement)
  let editPaidAbsolute = $state(false); // true once "edit total" or "clear" is tapped -- editPaid becomes the new total instead of an amount to add

  // Net cost of a tx = what you actually bore = full paid - paid back to you.
  const txNet = (tx) => round2((tx.amount || 0) - (tx.reimbursed || 0));

  function startEdit(i, tx) {
    editingIdx = i;
    editAmt = String(tx.amount);
    editNote = tx.note || '';
    editDest = category.key;
    editPaid = ''; // amount to ADD to tx.reimbursed, not the new total
    editPaidAbsolute = false;
  }
  function cancelEdit() {
    editingIdx = null;
  }
  function editPaidTotal(tx) {
    editPaidAbsolute = true;
    editPaid = tx.reimbursed ? String(tx.reimbursed) : '0';
  }
  function clearPaidTotal() {
    editPaidAbsolute = true;
    editPaid = '0';
  }

  async function writeCategories(newCats) {
    await db.months.update(month.key, { categories: newCats });
  }

  // Keep this month's Saving pot in step: its `initial` is the sum of Saving
  // contributions, which feeds the shared Goals pool.
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

  async function deleteTx(tx) {
    const key = category.key;
    const cats = month.categories.map((c) =>
      c.key === key
        ? { ...c, actual: round2(c.actual - txNet(tx)), transactions: (c.transactions || []).filter((t) => t !== tx) }
        : c
    );
    await writeCategories(cats);
    if (key === 'saving') await adjustPot(-txNet(tx));
    showToast('Entry deleted');
  }

  async function commitEdit(tx) {
    const amt = parseFloat(editAmt);
    if (!amt) return showToast('Enter an amount first');
    const note = editNote.trim();
    const paidInput = parseFloat(editPaid) || 0;
    const paid = editPaidAbsolute
      ? Math.min(Math.max(paidInput, 0), amt) // direct override of the total
      : Math.min(Math.max((tx.reimbursed || 0) + paidInput, 0), amt); // stacks onto what's already recorded
    const srcKey = category.key;
    const destKey = editDest;
    const oldNet = txNet(tx);
    const newNet = round2(amt - paid);
    const newTxFields = { amount: amt, date: tx.date, note: note || undefined, reimbursed: paid || undefined };

    if (destKey === srcKey) {
      const delta = round2(newNet - oldNet);
      const cats = month.categories.map((c) =>
        c.key === srcKey
          ? {
              ...c,
              actual: round2(c.actual + delta),
              transactions: (c.transactions || []).map((t) => (t === tx ? { ...t, ...newTxFields } : t)),
            }
          : c
      );
      await writeCategories(cats);
      if (srcKey === 'saving') await adjustPot(delta);
    } else {
      let cats = month.categories.map((c) =>
        c.key === srcKey
          ? { ...c, actual: round2(c.actual - oldNet), transactions: (c.transactions || []).filter((t) => t !== tx) }
          : c
      );
      cats = cats.map((c) =>
        c.key === destKey ? { ...c, actual: round2(c.actual + newNet), transactions: [...(c.transactions || []), newTxFields] } : c
      );
      await writeCategories(cats);
      if (srcKey === 'saving') await adjustPot(-oldNet);
      if (destKey === 'saving') await adjustPot(newNet);
      const destName = tmpl?.categories.find((c) => c.key === destKey)?.name ?? '';
      showToast(`Moved to ${destName}`);
    }
    editingIdx = null;
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function formatTime(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
  }
</script>

<div class="sheet" class:open>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>{category?.name ?? ''}</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-body">
    {#if category}
      <div class="card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px; border-color: {category.color}; box-shadow: 4px 4px 0 {category.color};">
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="dot" style="background:{category.color}"></span>
          <span style="font-size:13.5px; color:var(--lo);">Actual / Planned</span>
        </div>
        <span class="num" style="font-weight:700;">RM {fmt(category.actual)} / {fmt(category.planned)}</span>
      </div>

      <div class="field-lbl" style="margin-top:0;">Expenses this month · tap ✎ to fix</div>
      {#if transactions.length}
        <div class="card">
          {#each transactions as tx, i (i)}
            {#if editingIdx === i}
              <div class="tx-edit">
                <input class="note-input num" bind:value={editAmt} inputmode="decimal" placeholder="0.00" />
                <input class="note-input" bind:value={editNote} placeholder="Note (optional)" />
                <div class="mini-lbl paid-hd">
                  <span>Paid back to you (bill split / pay first)</span>
                  {#if tx.reimbursed}
                    <span class="paid-existing">
                      already RM {fmt(tx.reimbursed)}
                      <button class="icon-btn tiny" aria-label="Edit paid-back total" onclick={() => editPaidTotal(tx)}>
                        <svg viewBox="0 0 24 24" fill="none" width="11" height="11"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
                      </button>
                      <button class="icon-btn tiny" aria-label="Clear paid-back amount" onclick={clearPaidTotal}>
                        <svg viewBox="0 0 24 24" fill="none" width="11" height="11"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      </button>
                    </span>
                  {/if}
                </div>
                <input class="note-input num" bind:value={editPaid} inputmode="decimal" placeholder={editPaidAbsolute ? 'New total, e.g. 13.50' : tx.reimbursed ? 'Add more, e.g. 1.00' : '0.00'} />
                {#if editPaidAbsolute}<p class="hint-tiny">Editing the total directly — this replaces the RM {fmt(tx.reimbursed || 0)} already recorded.</p>{/if}
                <div class="mini-lbl">Move to category</div>
                <div class="chip-grid">
                  {#each month.categories as c (c.key)}
                    <button class="chip ghost" class:selected={editDest === c.key} style={editDest === c.key ? `color:${c.color}` : ''} onclick={() => (editDest = c.key)}>
                      <span class="dot" style="background:{c.color}"></span>{c.name}
                    </button>
                  {/each}
                </div>
                <div style="display:flex; gap:8px; margin-top:10px;">
                  <button class="io-btn" style="flex:1;" onclick={cancelEdit}>Cancel</button>
                  <button class="save-btn" style="flex:1; margin-top:0;" onclick={() => commitEdit(tx)}>Save</button>
                </div>
              </div>
            {:else}
              <div class="tx-row">
                <div>
                  <div class="tx-date">{formatDate(tx.date)}{formatTime(tx.date) ? ` · ${formatTime(tx.date)}` : ''}</div>
                  {#if tx.note}<div class="tx-note">{tx.note}</div>{/if}
                  {#if tx.reimbursed}<div class="tx-back">−RM {fmt(tx.reimbursed)} paid back · net RM {fmt(txNet(tx))}</div>{/if}
                </div>
                <span class="num tx-amt">RM {fmt(tx.amount)}</span>
                <button class="icon-btn small" aria-label="Edit entry" onclick={() => startEdit(i, tx)}>
                  <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
                </button>
                <button class="icon-btn small" aria-label="Delete entry" onclick={() => deleteTx(tx)}>
                  <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
            {/if}
          {/each}
        </div>
      {:else}
        <p class="hint">No itemized entries recorded yet — only the total (RM {fmt(category.actual)}) is on record. New expenses you log from here on will show up in this list, where you can edit or delete them.</p>
      {/if}
    {/if}
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
