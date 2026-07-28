<script>
  import { closedMonths } from '../lib/stores.js';
  import CategoryRow from '../lib/components/CategoryRow.svelte';
  import MoneyValue from '../lib/components/MoneyValue.svelte';

  let months = $derived($closedMonths ?? []);
  let expandedKey = $state(null);

  function toggle(key) {
    expandedKey = expandedKey === key ? null : key;
  }
</script>

<h1>History</h1>

{#each months as month (month.key)}
  <div class="history-month">
    <button class="month-toggle" onclick={() => toggle(month.key)}>
      <span>{month.label}</span>
      <MoneyValue value={month.recordedTotal} />
    </button>
    {#if expandedKey === month.key}
      <div class="month-detail">
        {#each month.categories as cat (cat.name)}
          <CategoryRow category={cat} />
        {/each}
        {#each month.extras as extra (extra.name)}
          <div class="cat-row extra">
            <span class="name">{extra.name}</span>
            <span class="amounts"><MoneyValue value={extra.actual} /></span>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <p class="empty">No closed months yet.</p>
{/each}

<style>
  h1 {
    color: #e6e6ea;
  }
  .history-month {
    border: 1px solid #26262f;
    border-radius: 10px;
    margin-bottom: 0.6rem;
    overflow: hidden;
  }
  .month-toggle {
    width: 100%;
    display: flex;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: #1a1a22;
    border: none;
    color: #e6e6ea;
    font-variant-numeric: tabular-nums;
  }
  .month-detail {
    padding: 0 1rem 0.5rem;
  }
  .cat-row.extra {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid #26262f;
    color: #b0b0bd;
    font-variant-numeric: tabular-nums;
  }
  .empty {
    color: #8a8a99;
  }
</style>
