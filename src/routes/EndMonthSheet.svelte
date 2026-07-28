<script>
  import { currentMonth, template, hutangPots } from '../lib/stores.js';
  import { computeSpentTotal, computeTotalRemaining, computeOpenPots, computePersonalSavings, round2 } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { MONTH_NAMES } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { currentView } from '../lib/viewStore.js';

  let { open, onClose } = $props();

  let month = $derived($currentMonth);
  let tmpl = $derived($template);
  let pots = $derived($hutangPots ?? []);

  let step = $state(1);
  let bonusOn = $state(false);
  let bonusAmount = $state('');

  $effect(() => {
    if (open) {
      step = 1;
      bonusOn = false;
      bonusAmount = '';
    }
  });

  let spentTotal = $derived(month ? computeSpentTotal(month) : 0);
  let leftover = $derived(month ? computeTotalRemaining(month) : 0);
  let openPotsNow = $derived(computeOpenPots(pots));
  let personalSavings = $derived(computePersonalSavings(pots));

  function nextMonthKey(key) {
    const [y, m] = key.split('-').map(Number);
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    return `${ny}-${String(nm).padStart(2, '0')}`;
  }

  async function confirmStartCycle() {
    const newKey = nextMonthKey(month.key);
    const newOrder = Number(newKey.split('-')[1]);
    const newLabel = MONTH_NAMES[newOrder - 1];
    const bonusAmt = bonusOn ? parseFloat(bonusAmount) || 0 : 0;
    // `leftover` is exactly what should carry forward; the new cycle's own
    // Starting balance is that plus its (this closing month's) income baseline.
    const newStartingBalance = round2(leftover + month.income);

    await db.transaction('rw', db.months, db.hutangPots, async () => {
      await db.months.update(month.key, { closed: 1, recordedTotal: spentTotal });

      await db.months.put({
        key: newKey,
        order: newOrder,
        label: newLabel,
        closed: 0,
        income: month.income,
        bonus: bonusAmt,
        startingBalance: newStartingBalance,
        categories: tmpl.categories.map((c) => ({ ...c, actual: 0 })),
        extras: [],
        recordedTotal: 0,
      });

      const savingPlanned = tmpl.categories.find((c) => c.key === 'saving')?.planned || 0;
      await db.hutangPots.put({ month: newKey, initial: savingPlanned, used: 0, send: 0 });
    });

    onClose();
    showToast(`${newLabel} started` + (bonusAmt > 0 ? ` · bonus RM ${fmt(bonusAmt)} added` : ''));
    currentView.set('home');
  }
</script>

<div class="sheet" class:open>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Back" onclick={() => (step = 1)} style={step === 1 ? 'visibility:hidden' : ''}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 1 3 7l6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <h2>{step === 1 ? `Close ${month?.label ?? ''}` : 'Start next month'}</h2>
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
  </div>
  <div class="sheet-body">
    {#if month}
      {#if step === 1}
        <p class="sub" style="margin-top:4px;">Here's how it wrapped up before it moves to History.</p>
        <div class="card" style="margin-bottom:14px;">
          <div class="balance-row">
            <div class="stat"><div class="k">Starting</div><div class="v num">{month.startingBalance != null ? 'RM ' + fmt(month.startingBalance) : '—'}</div></div>
            <div class="stat"><div class="k">Spent</div><div class="v num">RM {fmt(spentTotal)}</div></div>
            <div class="stat"><div class="k">Left over</div><div class="v num" class:up={leftover >= 0} class:down={leftover < 0}>{leftover >= 0 ? 'RM ' : '-RM '}{fmt(Math.abs(leftover))}</div></div>
          </div>
        </div>
        <div class="card">
          <div class="cat-name-row" style="margin-bottom:0;"><span>Hutang status</span></div>
          <div class="cat-amt" style="margin-top:4px;">
            {openPotsNow.length ? `${openPotsNow.length} pot${openPotsNow.length > 1 ? 's' : ''} still open · RM ${fmt(personalSavings)} unallocated` : 'All Hutang pots fully settled'}
          </div>
        </div>
        <button class="save-btn" onclick={() => (step = 2)}>Continue</button>
      {:else}
        <p class="sub" style="margin-top:4px;">Starting <span>{MONTH_NAMES[month.order % 12]}</span> with your fixed income.</p>
        <div class="card" style="margin-bottom:6px; display:flex; align-items:center; justify-content:space-between;">
          <span style="font-size:13.5px; color:var(--lo);">Net income</span>
          <span class="num" style="font-size:17px; font-weight:700;">RM {fmt(month.income)}</span>
        </div>
        <label class="bonus-toggle">
          <input type="checkbox" bind:checked={bonusOn} />
          <span>I received a bonus this month</span>
        </label>
        {#if bonusOn}
          <div class="field-lbl" style="margin-top:0;">Bonus amount</div>
          <input class="note-input num" placeholder="0.00" inputmode="decimal" bind:value={bonusAmount} />
        {/if}
        <button class="save-btn" onclick={confirmStartCycle}>Start {MONTH_NAMES[month.order % 12]}</button>
      {/if}
    {/if}
  </div>
</div>
