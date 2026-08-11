<script>
  import { currentMonth, template } from '../lib/stores.js';
  import { computeSpentTotal, computeTotalBalance, computeBankFreeTotal, round2 } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { MONTH_NAMES, getCardDesign, cardBorderColor } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { currentView, sheetPageCount } from '../lib/viewStore.js';
  import { banks as bankPreviewStore, adjustBankBalance } from '../lib/bankPreviewStore.js';
  import CardPattern from '../lib/components/CardPattern.svelte';

  let { open, onClose } = $props();

  // .sheet-page, not a position:fixed overlay -- shares the root document
  // scroll with the 4 main tabs instead of its own nested overflow:auto
  // scroller (see app.css comment on .sheet-page and BankFormSheet.svelte
  // for the on-device finding this is based on). Registers on
  // sheetPageCount so App.svelte's tab bar hides while this is showing --
  // this one doesn't belong to any of the 4 tabs, so the bar has nothing
  // sensible to switch to while it's up.
  $effect(() => {
    if (!open) return;
    sheetPageCount.update((n) => n + 1);
    return () => sheetPageCount.update((n) => n - 1);
  });

  let month = $derived($currentMonth);
  let tmpl = $derived($template);
  let banksList = $derived($bankPreviewStore);

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
  // What actually carries forward -- the real, live bank total (see
  // computeBankFreeTotal's comment in calc.js), not the old single-pool
  // startingBalance chain. That old figure has no idea about Transfers or
  // goal contributions/withdrawals, so it silently drifts from what you
  // really have; this reads it straight from the banks those operations
  // actually changed.
  let leftover = $derived(computeBankFreeTotal(banksList));
  let totalBalance = $derived(month ? computeTotalBalance(month) : null);
  // This summary isn't tied to one specific bank, but the wrap-up card
  // below borrows the main bank's own card design/color so it reads as
  // "your money," same visual language as every other bank card in the
  // app, instead of the old plain stat-grid box.
  let mainBank = $derived(banksList.find((b) => b.bank.isMain) || banksList[0]);
  let wrapDesign = $derived(getCardDesign(mainBank?.bank?.design));
  let wrapBorderColor = $derived(mainBank ? cardBorderColor(mainBank.bank) : 'var(--stroke-2)');

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
    // Kept purely as a historical/record field now (History still reads it
    // for closed months) -- the live month's own Buffer/Remaining no longer
    // read it at all, see computeBankFreeTotal.
    const newStartingBalance = round2(leftover + month.income);

    await db.transaction('rw', db.months, db.banks, async () => {
      await db.months.update(month.key, { closed: 1, recordedTotal: spentTotal });

      await db.months.put({
        key: newKey,
        order: newOrder,
        label: newLabel,
        closed: 0,
        income: month.income,
        bonus: bonusAmt,
        additionalIncome: 0,
        startingBalance: newStartingBalance,
        categories: tmpl.categories.map((c) => ({ ...c, actual: 0 })),
        extras: [],
        recordedTotal: 0,
        // The exact moment this cycle began -- cycles don't align to calendar
        // month boundaries (e.g. "August" can start on 31 July), so this is
        // what "current cycle" checks compare against, not the month key.
        startedAt: new Date().toISOString(),
      });

      // Salary (+ bonus) has to actually land in a real bank now that
      // Buffer/Remaining are computed straight from bank balances --
      // otherwise the new cycle would start with none of its own income
      // counted anywhere until it got tagged some other way. Goes to
      // whichever bank is marked "main" (falling back to the first one),
      // same as everywhere else that needs a default bank.
      if (mainBank) await adjustBankBalance(mainBank.bank.id, round2(month.income + bonusAmt));

      // No Hutang pot is created here anymore -- a pot only opens once money
      // is actually logged against the Saving category (see AddExpenseSheet),
      // so its initial amount reflects what was really set aside, not an
      // assumed fixed figure.
    });

    onClose();
    showToast(`${newLabel} started` + (bonusAmt > 0 ? ` · bonus RM ${fmt(bonusAmt)} added` : ''));
    currentView.set('home');
  }
</script>

<div class="sheet-page" class:open>
  <div class="sheet-page-hd">
    <button class="icon-btn" aria-label="Back" onclick={() => (step = 1)} style={step === 1 ? 'visibility:hidden' : ''}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 1 3 7l6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <h2>{step === 1 ? `Close ${month?.label ?? ''}` : 'Start next month'}</h2>
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
  </div>
  <div class="sheet-page-body">
    {#if month}
      {#if step === 1}
        <p class="sub" style="margin-top:4px;">Here's how it wrapped up before it moves to History.</p>
        <div
          class="wrap-card"
          style="border-color:{wrapBorderColor}; box-shadow:5px 5px 0 {wrapBorderColor}; background:{wrapDesign.bg}; --card-fg:{wrapDesign.fg}; --card-dim:{wrapDesign.dim};"
        >
          <CardPattern kind={wrapDesign.pattern} color={wrapDesign.patternColor} opacity={wrapDesign.patternOpacity} />
          <div class="wrap-card-top">
            <div class="wrap-month">{month.label}</div>
            <div class="bank-brand">BAJETBRO</div>
          </div>
          <div class="bank-balance-lbl">Left over</div>
          <div class="bank-balance-amt" class:down={leftover < 0}>
            <span class="cur">{leftover >= 0 ? 'RM' : '-RM'}</span>{fmt(Math.abs(leftover))}
          </div>
          <div class="bank-stats-row">
            <div class="bank-stat">
              <div class="k">Income</div>
              <div class="v num" style="color:var(--good);">{totalBalance != null ? 'RM ' + fmt(totalBalance) : '—'}</div>
            </div>
            <div class="bank-stat right">
              <div class="k">Spent</div>
              <div class="v num" style="color:var(--red);">RM {fmt(spentTotal)}</div>
            </div>
          </div>
        </div>
        <button class="save-btn" onclick={() => (step = 2)}>Continue</button>
      {:else}
        <p class="sub" style="margin-top:4px;">Starting <span>{MONTH_NAMES[month.order % 12]}</span> with your fixed income.</p>
        <div class="card" style="margin-bottom:6px; display:flex; align-items:center; justify-content:space-between;">
          <span style="font-size:13.5px; color:var(--lo);">Salary</span>
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

<style>
  /* Matches BankCard.svelte's own bank-card look (border/shadow/pattern/
     traffic-lights/brand text/big-amount typography) rather than the old
     plain .card + .balance-row + .stat grid -- same duplicated-per-
     component pattern that look already uses everywhere else (ManageBanksSheet,
     BankFormFields), since these classes aren't shared via app.css. */
  .wrap-card {
    background: var(--panel);
    border: 2px solid var(--stroke-2);
    border-radius: 22px;
    padding: 32px 18px 16px;
    position: relative;
    z-index: 0;
    overflow: hidden;
    margin-bottom: 14px;
  }
  .wrap-card::before {
    content: "";
    position: absolute;
    top: 14px; left: 18px;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--red);
    box-shadow: 16px 0 0 var(--gold), 32px 0 0 var(--good);
  }
  .wrap-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .wrap-month { font-weight: 700; font-size: 14.5px; color: var(--card-fg, var(--hi)); }
  .bank-brand {
    font-family: var(--display); font-size: 10px; font-weight: 800; letter-spacing: 0.08em;
    color: var(--card-dim, var(--dim)); text-transform: uppercase;
  }
  .bank-balance-lbl { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--card-dim, var(--dim)); }
  .bank-balance-amt {
    font-family: var(--mono); font-variant-numeric: tabular-nums;
    font-size: 32px; font-weight: 700; letter-spacing: -0.01em;
    margin: 3px 0 14px;
    color: var(--card-fg, var(--hi));
  }
  .bank-balance-amt.down { color: var(--red); }
  .bank-balance-amt .cur { font-size: 15px; color: var(--card-dim, var(--dim)); font-weight: 600; margin-right: 3px; }
  .bank-stats-row { display: flex; justify-content: space-between; align-items: flex-start; }
  .bank-stat.right { text-align: right; }
  .bank-stat .k { font-size: 10.5px; color: var(--card-dim, var(--dim)); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .bank-stat .v { font-size: 14px; font-weight: 700; margin-top: 3px; }
</style>
