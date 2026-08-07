<script>
  import { fmt } from '../lib/format.js';

  let { open, bank, transactions = [], onClose } = $props();
</script>

<div class="sheet" class:open>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>{bank?.name ?? 'Transactions'}</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-body">
    <div class="card">
      {#each transactions as t}
        <div class="tx-row">
          <span class="dot" style="background:{t.color}"></span>
          <div>
            <div class="tx-note-main">{t.note}</div>
            <div class="tx-date">{t.date}</div>
          </div>
          <span class="num tx-amt" style="color:{t.income ? 'var(--good)' : 'var(--hi)'};">{t.income ? '+' : '−'}RM {fmt(t.amount)}</span>
        </div>
      {:else}
        <p class="hint" style="margin:2px 0;">No transactions yet on this bank.</p>
      {/each}
    </div>
  </div>
</div>

<style>
  .tx-row { display: flex; align-items: center; gap: 10px; padding: 12px 4px; border-bottom: 1px solid var(--stroke); }
  .tx-row:last-child { border-bottom: none; }
  .tx-row > div { flex: 1; min-width: 0; }
  .tx-note-main { font-size: 13.5px; font-weight: 600; color: var(--hi); }
  .tx-date { font-size: 11px; color: var(--dim); margin-top: 2px; }
  .tx-amt { font-weight: 700; flex-shrink: 0; }
</style>
