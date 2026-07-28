<script>
  import { hutangPots, hutangLedger, tabungHaji, dividends } from '../lib/stores.js';
  import { computeHutangLedgerRemain, computeTabungHajiTotal } from '../lib/calc.js';
  import PotCard from '../lib/components/PotCard.svelte';
  import MoneyValue from '../lib/components/MoneyValue.svelte';

  let pots = $derived($hutangPots ?? []);
  let ledger = $derived($hutangLedger);
  let th = $derived($tabungHaji);
  let divs = $derived($dividends ?? []);

  let ledgerRemain = $derived(ledger ? computeHutangLedgerRemain(ledger, pots) : 0);
  let tabungHajiTotal = $derived(th ? computeTabungHajiTotal(th, pots, divs) : 0);
  let sortedPots = $derived([...pots].sort((a, b) => (a.month < b.month ? 1 : -1)));
</script>

<h1>Hutang</h1>

{#if ledger}
  <section class="ledger-summary">
    <div class="row"><span>Initial</span><MoneyValue value={ledger.initial} /></div>
    <div class="row remain"><span>Remain</span><MoneyValue value={ledgerRemain} /></div>
  </section>
{/if}

<section class="pots">
  <h2>Monthly Pots</h2>
  {#each sortedPots as pot (pot.month)}
    <PotCard {pot} />
  {/each}
</section>

<section class="tabung-haji">
  <h2>Tabung Haji</h2>
  {#if th}
    <div class="row"><span>Total</span><MoneyValue value={tabungHajiTotal} /></div>
    <p class="hint">Fixed deposit + open pot remains + dividends</p>
  {/if}
</section>

<section class="asb muted">
  <h2>ASB</h2>
  <p>Not started</p>
</section>

<style>
  h1 {
    color: #e6e6ea;
  }
  h2 {
    color: #e6e6ea;
    font-size: 1rem;
    margin-bottom: 0.5rem;
  }
  .ledger-summary {
    border: 1px solid #26262f;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    margin-bottom: 1.5rem;
    background: #1a1a22;
  }
  .row {
    display: flex;
    justify-content: space-between;
    color: #b0b0bd;
    font-variant-numeric: tabular-nums;
    padding: 0.2rem 0;
  }
  .row.remain {
    color: #e8c766;
    font-weight: 600;
  }
  .pots,
  .tabung-haji,
  .asb {
    margin-bottom: 1.5rem;
  }
  .asb.muted {
    opacity: 0.5;
  }
  .hint {
    color: #8a8a99;
    font-size: 0.8rem;
  }
</style>
