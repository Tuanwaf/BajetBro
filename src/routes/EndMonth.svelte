<script>
  import { currentMonth, template, hutangPots } from '../lib/stores.js';
  import { computePotRemain } from '../lib/calc.js';
  import MoneyValue from '../lib/components/MoneyValue.svelte';
  import db from '../lib/db.js';
  import { currentView } from '../lib/viewStore.js';

  const MONTH_LABELS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  let step = $state(1);
  let bonus = $state(0);

  let month = $derived($currentMonth);
  let tmpl = $derived($template);
  let pots = $derived($hutangPots ?? []);

  let totalSpent = $derived(month ? month.recordedTotal : 0);
  let leftover = $derived(month ? month.income + (month.bonus || 0) - totalSpent : 0);
  let currentPot = $derived(month ? pots.find((p) => p.month === month.key) : null);
  let currentPotRemain = $derived(currentPot ? computePotRemain(currentPot) : 0);

  function nextMonthKey(key) {
    const [y, m] = key.split('-').map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return `${ny}-${String(nm).padStart(2, '0')}`;
  }

  async function confirmEndMonth() {
    const newKey = nextMonthKey(month.key);
    const newOrder = Number(newKey.split('-')[1]);
    const newLabel = MONTH_LABELS[newOrder - 1];
    const bonusAmount = Number(bonus) || 0;

    await db.transaction('rw', db.months, db.hutangPots, async () => {
      await db.months.update(month.key, { closed: 1 });

      await db.months.put({
        key: newKey,
        order: newOrder,
        label: newLabel,
        closed: 0,
        income: month.income, // this closing month's income funds the new cycle
        bonus: bonusAmount,
        categories: tmpl.categories.map((c) => ({ ...c, actual: 0 })),
        extras: [],
        recordedTotal: 0,
      });

      const savingPlanned = tmpl.categories.find((c) => c.name === 'Saving')?.planned || 0;
      await db.hutangPots.put({ month: newKey, initial: savingPlanned, used: 0, send: 0 });
    });

    step = 1;
    bonus = 0;
    currentView.set('home');
  }
</script>

<h1>End Month</h1>

{#if month}
  {#if step === 1}
    <section class="close-out">
      <h2>{month.label} Summary</h2>
      <div class="row"><span>Income</span><MoneyValue value={month.income + (month.bonus || 0)} /></div>
      <div class="row"><span>Spent</span><MoneyValue value={totalSpent} /></div>
      <div class="row leftover"><span>Leftover</span><MoneyValue value={leftover} /></div>

      {#if currentPot}
        <h3>Hutang Pot ({month.key})</h3>
        <div class="row"><span>Remain in pot</span><MoneyValue value={currentPotRemain} /></div>
      {/if}
    </section>
    <button class="primary-btn" onclick={() => (step = 2)}>Continue</button>
  {:else if step === 2}
    <section class="new-cycle">
      <h2>Start New Cycle</h2>
      <div class="row"><span>Fixed income baseline</span><MoneyValue value={month.income} /></div>
      <label class="bonus-label">
        Bonus this cycle
        <input type="number" step="0.01" bind:value={bonus} />
      </label>
    </section>
    <button class="primary-btn" onclick={confirmEndMonth}>Confirm &amp; Start New Month</button>
  {/if}
{/if}

<style>
  h1 {
    color: #e6e6ea;
  }
  h2,
  h3 {
    color: #e6e6ea;
    font-size: 1rem;
  }
  .row {
    display: flex;
    justify-content: space-between;
    color: #b0b0bd;
    font-variant-numeric: tabular-nums;
    padding: 0.3rem 0;
  }
  .row.leftover {
    color: #e8c766;
    font-weight: 600;
  }
  .bonus-label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    color: #b0b0bd;
    margin-top: 0.5rem;
  }
  .bonus-label input {
    background: #1a1a22;
    border: 1px solid #26262f;
    border-radius: 6px;
    color: #e6e6ea;
    padding: 0.4rem 0.5rem;
  }
  .primary-btn {
    width: 100%;
    margin-top: 1.5rem;
    padding: 0.8rem;
    border: none;
    border-radius: 10px;
    background: #e8c766;
    color: #14141a;
    font-weight: 600;
  }
</style>
