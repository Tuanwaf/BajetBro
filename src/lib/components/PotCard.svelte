<script>
  import { computePotRemain } from '../calc.js';
  import { fmt } from '../format.js';

  let { pot, isOpen } = $props();
  let remain = $derived(computePotRemain(pot));
</script>

<div class="card hu-card" class:hu-card-open={isOpen} class:hu-card-settled={!isOpen}>
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <div class="hu-name">{pot.month}</div>
    {#if isOpen}
      <span class="pill gold">RM {fmt(remain)} open</span>
    {:else}
      <span class="pill neutral">Settled</span>
    {/if}
  </div>
  <div class="hu-grid">
    <div class="hu-cell"><span class="hu-k" style="color:var(--h-initial)">Initial</span><b class="num">{fmt(pot.initial)}</b></div>
    <div class="hu-cell"><span class="hu-k" style="color:var(--h-used)">Used</span><b class="num">{fmt(pot.used)}</b></div>
    <div class="hu-cell"><span class="hu-k" style="color:var(--h-send)">Send</span><b class="num">{fmt(pot.send)}</b></div>
    <div class="hu-cell"><span class="hu-k" style="color:var(--h-remain)">Remain</span><b class="num">{fmt(remain)}</b></div>
  </div>
</div>
