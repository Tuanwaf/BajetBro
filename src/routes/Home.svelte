<script>
  import { currentMonth, template } from '../lib/stores.js';
  import { computeAdhocPlanned, computeAdhocActual } from '../lib/calc.js';
  import CategoryRow from '../lib/components/CategoryRow.svelte';
  import MoneyValue from '../lib/components/MoneyValue.svelte';
  import { currentView } from '../lib/viewStore.js';

  let month = $derived($currentMonth);
  let tmpl = $derived($template);
  let adhocPlanned = $derived(month && tmpl ? computeAdhocPlanned(month, tmpl) : 0);
  let adhocActual = $derived(month ? computeAdhocActual(month) : 0);
  let totalSpent = $derived(month ? month.recordedTotal : 0);
  let leftover = $derived(month ? month.income + (month.bonus || 0) - totalSpent : 0);
</script>

{#if month}
  <header class="month-header">
    <h1>{month.label}</h1>
    <p class="income">Income: <MoneyValue value={month.income + (month.bonus || 0)} /></p>
  </header>

  <section class="categories">
    {#each month.categories as cat (cat.name)}
      <CategoryRow category={cat} />
    {/each}
    <div class="cat-row adhoc">
      <span class="dot" style="background:#e8c766"></span>
      <span class="name">Ad-hoc</span>
      <span class="amounts">
        <MoneyValue value={adhocActual} />
        <span class="planned">/ <MoneyValue value={adhocPlanned} /></span>
      </span>
    </div>
  </section>

  <section class="summary">
    <div class="row"><span>Total spent</span><MoneyValue value={totalSpent} /></div>
    <div class="row leftover"><span>Leftover</span><MoneyValue value={leftover} /></div>
  </section>

  <button class="end-month-btn" onclick={() => currentView.set('endMonth')}>End Month</button>
{:else}
  <p class="loading">Loading...</p>
{/if}

<style>
  .month-header h1 {
    margin: 0 0 0.2rem;
    color: #e6e6ea;
  }
  .income {
    color: #b0b0bd;
    margin: 0 0 1rem;
  }
  .cat-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid #26262f;
  }
  .cat-row .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
  .cat-row .name {
    flex: 1;
    color: #e6e6ea;
  }
  .cat-row .amounts {
    color: #e6e6ea;
    font-variant-numeric: tabular-nums;
  }
  .cat-row .planned {
    color: #8a8a99;
  }
  .summary {
    margin-top: 1rem;
  }
  .summary .row {
    display: flex;
    justify-content: space-between;
    padding: 0.4rem 0;
    color: #b0b0bd;
    font-variant-numeric: tabular-nums;
  }
  .summary .leftover {
    color: #e8c766;
    font-weight: 600;
    font-size: 1.1rem;
  }
  .end-month-btn {
    width: 100%;
    margin-top: 1.5rem;
    padding: 0.8rem;
    border: none;
    border-radius: 10px;
    background: #e8c766;
    color: #14141a;
    font-weight: 600;
  }
  .loading {
    color: #8a8a99;
  }
</style>
