<script>
  import MoneyValue from './MoneyValue.svelte';
  import { computePotRemain } from '../calc.js';

  let { pot } = $props();
  let remain = $derived(computePotRemain(pot));
</script>

<div class="pot-card" class:open={remain > 0}>
  <h4>{pot.month}</h4>
  <div class="row"><span>Initial</span><MoneyValue value={pot.initial} /></div>
  <div class="row"><span>Used</span><MoneyValue value={pot.used} /></div>
  <div class="row"><span>Send</span><MoneyValue value={pot.send} /></div>
  <div class="row remain"><span>Remain</span><MoneyValue value={remain} /></div>
</div>

<style>
  .pot-card {
    border: 1px solid #26262f;
    border-radius: 10px;
    padding: 0.75rem 1rem;
    margin-bottom: 0.6rem;
    background: #1a1a22;
  }
  .pot-card.open {
    border-color: #9b51e0;
  }
  .pot-card h4 {
    margin: 0 0 0.4rem;
    color: #e6e6ea;
  }
  .row {
    display: flex;
    justify-content: space-between;
    color: #b0b0bd;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
  }
  .row.remain {
    color: #e8c766;
    font-weight: 600;
  }
</style>
