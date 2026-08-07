<script>
  import { fmt } from '../format.js';

  let { bank, balance, income, spending, isMain = false } = $props();

  let hidden = $state(false);
</script>

<div class="bank-card" style="border-color:{bank.color}; box-shadow:5px 5px 0 {bank.color};">
  <div class="bank-card-top">
    <div class="bank-id">
      <span class="bank-logo" style="background:{bank.color}">{bank.name[0]}</span>
      <div>
        <div class="bank-name">{bank.name}</div>
        <div class="bank-tag">{isMain ? 'Main bank' : 'Added'}</div>
      </div>
    </div>
    <div class="bank-brand">BAJETBRO</div>
  </div>

  <div class="bank-balance-row">
    <span class="bank-balance-lbl">Balance</span>
    <button class="eye-btn" aria-label={hidden ? 'Show balance' : 'Hide balance'} onclick={() => (hidden = !hidden)}>
      {#if hidden}
        <svg viewBox="0 0 24 24" fill="none" width="15" height="15"><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.5 6.7C4.3 8.2 2.7 10.3 2 12c1.6 3.6 5.6 7 10 7 1.8 0 3.5-.5 5-1.4M9.9 4.2A10.6 10.6 0 0 1 12 4c4.4 0 8.4 3.4 10 7-.5 1.1-1.2 2.2-2.1 3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none" width="15" height="15"><path d="M2 12c1.6-3.6 5.6-7 10-7s8.4 3.4 10 7c-1.6 3.6-5.6 7-10 7s-8.4-3.4-10-7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg>
      {/if}
    </button>
  </div>
  <div class="bank-balance-amt"><span class="cur">RM</span>{hidden ? '••••••' : fmt(balance)}</div>

  <div class="bank-stats-row">
    <div class="bank-stat">
      <div class="k">Income</div>
      <div class="v num" style="color:var(--good);">RM {fmt(income)}</div>
    </div>
    <div class="bank-stat right">
      <div class="k">Spending</div>
      <div class="v num" style="color:var(--red);">RM {fmt(spending)}</div>
    </div>
  </div>
</div>

<style>
  .bank-card {
    background: var(--panel);
    border: 2px solid var(--stroke-2);
    border-radius: 22px;
    padding: 32px 18px 16px;
    position: relative;
  }
  /* Traffic-light window dots, same treatment as the hero balance-card
     elsewhere in the app -- reuses the app's own semantic colors rather than
     literal macOS red/yellow/green. */
  .bank-card::before {
    content: "";
    position: absolute;
    top: 14px; left: 18px;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--red);
    box-shadow: 16px 0 0 var(--gold), 32px 0 0 var(--good);
  }
  .bank-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .bank-id { display: flex; align-items: center; gap: 10px; }
  .bank-logo {
    width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: var(--accent-ink); font-family: var(--display); font-weight: 800; font-size: 15px;
    border: 1.5px solid var(--stroke-2);
  }
  .bank-name { font-weight: 700; font-size: 14.5px; }
  .bank-tag { font-size: 10.5px; color: var(--dim); font-weight: 600; margin-top: 1px; }
  .bank-brand {
    font-family: var(--display); font-size: 10px; font-weight: 800; letter-spacing: 0.08em;
    color: var(--dim); text-transform: uppercase;
  }

  .bank-balance-row { display: flex; align-items: center; gap: 6px; }
  .bank-balance-lbl { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--dim); }
  .eye-btn { background: none; border: none; padding: 2px; color: var(--dim); display: flex; }
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
</style>
