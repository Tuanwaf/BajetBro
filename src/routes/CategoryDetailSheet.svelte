<script>
  import { fmt } from '../lib/format.js';

  let { open, category, onClose } = $props();

  let transactions = $derived.by(() => {
    const list = category?.transactions || [];
    return [...list].sort((a, b) => new Date(b.date) - new Date(a.date));
  });

  function formatDate(iso) {
    const d = new Date(iso);
    return d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
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

      <div class="field-lbl" style="margin-top:0;">Expenses this month</div>
      {#if transactions.length}
        <div class="card">
          {#each transactions as tx, i (i)}
            <div class="tx-row">
              <div>
                <div class="tx-date">{formatDate(tx.date)} · {formatTime(tx.date)}</div>
                {#if tx.note}<div class="tx-note">{tx.note}</div>{/if}
              </div>
              <span class="num tx-amt">RM {fmt(tx.amount)}</span>
            </div>
          {/each}
        </div>
      {:else}
        <p class="hint">No itemized entries recorded yet — only the total (RM {fmt(category.actual)}) is on record. New expenses you log from here on will show up in this list.</p>
      {/if}
    {/if}
  </div>
</div>

<style>
  .tx-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 4px;
    border-bottom: 1px solid var(--stroke);
  }
  .tx-row:last-child {
    border-bottom: none;
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
</style>
