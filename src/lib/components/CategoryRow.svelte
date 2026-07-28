<script>
  import MoneyValue from './MoneyValue.svelte';

  let { category } = $props();
</script>

<div class="cat-row">
  <span class="dot" style="background:{category.color}"></span>
  <span class="name">
    {category.name}
    {#if category.note}<em class="note">({category.note})</em>{/if}
  </span>
  <span class="amounts">
    <MoneyValue value={category.actual} />
    {#if category.planned != null}
      <span class="planned">/ <MoneyValue value={category.planned} /></span>
    {/if}
  </span>
</div>

<style>
  .cat-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid #26262f;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .name {
    flex: 1;
    color: #e6e6ea;
  }
  .note {
    color: #8a8a99;
    font-size: 0.8rem;
    font-style: italic;
  }
  .amounts {
    color: #e6e6ea;
    font-variant-numeric: tabular-nums;
  }
  .planned {
    color: #8a8a99;
  }
</style>
