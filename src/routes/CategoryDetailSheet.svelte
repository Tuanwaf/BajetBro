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

  function startEdit(i, tx) {
    editingIdx = i;
    editAmt = String(tx.amount);
    editNote = tx.note || '';
    editDest = category.key;
  }
  function cancelEdit() {
    editingIdx = null;
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
        ? { ...c, actual: round2(c.actual - tx.amount), transactions: (c.transactions || []).filter((t) => t !== tx) }
        : c
    );
    await writeCategories(cats);
    if (key === 'saving') await adjustPot(-tx.amount);
    showToast('Entry deleted');
  }

  async function commitEdit(tx) {
    const amt = parseFloat(editAmt);
    if (!amt) return showToast('Enter an amount first');
    const note = editNote.trim();
    const srcKey = category.key;
    const destKey = editDest;

    if (destKey === srcKey) {
      const delta = round2(amt - tx.amount);
      const cats = month.categories.map((c) =>
        c.key === srcKey
          ? {
              ...c,
              actual: round2(c.actual + delta),
              transactions: (c.transactions || []).map((t) => (t === tx ? { ...t, amount: amt, note: note || undefined } : t)),
            }
          : c
      );
      await writeCategories(cats);
      if (srcKey === 'saving') await adjustPot(delta);
    } else {
      const newTx = { amount: amt, date: tx.date, note: note || undefined };
      let cats = month.categories.map((c) =>
        c.key === srcKey
          ? { ...c, actual: round2(c.actual - tx.amount), transactions: (c.transactions || []).filter((t) => t !== tx) }
          : c
      );
      cats = cats.map((c) =>
        c.key === destKey ? { ...c, actual: round2(c.actual + amt), transactions: [...(c.transactions || []), newTx] } : c
      );
      await writeCategories(cats);
      if (srcKey === 'saving') await adjustPot(-tx.amount);
      if (destKey === 'saving') await adjustPot(amt);
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
      <div class="card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
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
</style>
