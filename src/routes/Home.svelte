<script>
  import { currentMonth, template, loans, userName } from '../lib/stores.js';
  import {
    computeBufferPlanned,
    computeBufferActual,
    computeSpentTotal,
    computeTotalRemaining,
    computeTotalBalance,
    computePlannedTotal,
    computeReimbursedTotal,
    round2,
  } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { BUFFER_COLOR, MONTH_NAMES } from '../lib/constants.js';
  import { currentView } from '../lib/viewStore.js';
  import { showToast } from '../lib/toast.js';
  import db from '../lib/db.js';
  import CategoryDetailSheet from './CategoryDetailSheet.svelte';
  import BufferDetailSheet from './BufferDetailSheet.svelte';
  import ReimbursementsSheet from './ReimbursementsSheet.svelte';
  import LoanLogSheet from './LoanLogSheet.svelte';

  let { onEndMonth } = $props();

  let month = $derived($currentMonth);
  let tmpl = $derived($template);

  let year = $derived(month ? month.key.split('-')[0] : '');
  let bufferPlanned = $derived(month ? computeBufferPlanned(month) : 0);
  let bufferActual = $derived(month ? computeBufferActual(month) : 0);
  let spentTotal = $derived(month ? computeSpentTotal(month) : 0);
  let totalRemaining = $derived(month ? computeTotalRemaining(month) : 0);
  let totalBalance = $derived(month ? computeTotalBalance(month) : null);
  let plannedTotal = $derived(month ? computePlannedTotal(month) : 0);
  let reimbursedTotal = $derived(month ? computeReimbursedTotal(month) : 0);
  let reimburseOpen = $state(false);

  let bufferOpen = $state(false);
  let bufferLabel = $state(null);
  let bufferInfo = $derived(rowInfo({ actual: bufferActual, planned: bufferPlanned }));
  // Collapse buffer extras that share a label into one line (summed); the
  // individual entries stay viewable/editable in the BufferDetailSheet.
  let bufferGroups = $derived.by(() => {
    const map = new Map();
    for (const e of month?.extras || []) map.set(e.name, round2((map.get(e.name) || 0) + (e.actual || 0)));
    return [...map.entries()].map(([name, total]) => ({ name, total }));
  });
  let detailCategoryKey = $state(null);
  let detailCategory = $derived(detailCategoryKey ? month?.categories.find((c) => c.key === detailCategoryKey) : null);

  // Loan log: purely a manual record of who owes who, kept entirely separate
  // from budget/expense calculations -- shown split (never netted together)
  // per the user's preference.
  let loanList = $derived($loans ?? []);
  let loanLent = $derived(round2(loanList.filter((l) => l.direction === 'lent').reduce((s, l) => s + l.amount, 0)));
  let loanOwed = $derived(round2(loanList.filter((l) => l.direction === 'borrowed').reduce((s, l) => s + l.amount, 0)));
  let loanLogOpen = $state(false);

  // First-run setup: a fresh install has a template but no month yet, and
  // nothing else in the app can create the first one (End Month only rolls
  // an EXISTING month forward), so Home has to offer it directly.
  // "Income" here means the comprehensive starting figure shown on Home
  // (Salary + whatever else you're starting with) -- NOT just salary. It
  // maps to month.startingBalance, which every later month already folds
  // its own Salary into (see calc.js), so asking for the all-in figure up
  // front keeps month 1 consistent with every month after it.
  let obStartMoney = $state('');
  let obSalary = $state('');
  let obName = $state('');

  async function startFirstMonth() {
    const salary = parseFloat(obSalary);
    if (!salary) return showToast('Enter your salary first');
    // Left blank = no extra on top of salary, i.e. starting money == salary.
    const startingBalance = obStartMoney.trim() ? parseFloat(obStartMoney) || 0 : salary;
    const name = obName.trim();
    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const label = MONTH_NAMES[now.getMonth()];
    await db.months.put({
      key,
      order: now.getMonth() + 1,
      label,
      closed: 0,
      income: salary,
      bonus: 0,
      additionalIncome: 0,
      startingBalance,
      categories: tmpl.categories.map((c) => ({ ...c, actual: 0 })),
      extras: [],
      recordedTotal: 0,
      startedAt: now.toISOString(),
    });
    if (name) await db.meta.put({ key: 'userName', value: name });
    showToast(`${label} started`);
  }

  function rowInfo(cat) {
    const pct = cat.planned > 0 ? Math.min(100, Math.round((cat.actual / cat.planned) * 100)) : cat.actual > 0 ? 100 : 0;
    const over = cat.actual > cat.planned;
    return { pct, over };
  }

  async function toggleLock(catKey) {
    const categories = month.categories.map((c) => {
      if (c.key !== catKey) return c;
      if (c.locked) {
        return { ...c, locked: false };
      }
      const leftover = round2(c.planned - c.actual);
      return { ...c, locked: true, lockedLeftover: leftover };
    });
    await db.months.update(month.key, { categories });
  }
</script>

{#if month && tmpl}
  <h2 class="title">Hey{$userName ? `, ${$userName}` : ''} 👋</h2>
  <p class="sub">{month.label} {year}</p>

  <div class="balance-card" data-guide="balance-remaining" style="border-color: var(--gold); box-shadow: 5px 5px 0 var(--gold);">
    <div class="balance-top">
      <div class="lbl">Remaining this month</div>
      <span class="pill" class:good={totalRemaining >= 0} class:bad={totalRemaining < 0}>
        {totalRemaining >= 0 ? 'On track' : 'Over budget'}
      </span>
    </div>
    <div class="balance-amt"><span class="cur">RM</span>{fmt(totalRemaining)}</div>
    <div class="balance-row" data-guide="balance-stats">
      <div class="stat">
        <div class="k">Income</div>
        <div class="v num">
          {totalBalance != null ? 'RM ' + fmt(totalBalance) : '—'}
          {#if month.additionalIncome > 0}<span style="color:var(--good); font-size:10.5px;"> +{fmt(month.additionalIncome)}</span>{/if}
        </div>
      </div>
      <div class="stat">
        <div class="k">Salary</div>
        <div class="v num">
          RM {fmt(month.income)}
          {#if month.bonus > 0}<span style="color:var(--good); font-size:10.5px;"> +{fmt(month.bonus)}</span>{/if}
        </div>
      </div>
      <div class="stat">
        <div class="k">Spent</div>
        <div class="v num" style="color:var(--red);">RM {fmt(spentTotal)}</div>
      </div>
    </div>
  </div>

  {#if reimbursedTotal > 0}
    <button class="paidback-row" onclick={() => (reimburseOpen = true)}>
      <span>Paid back to you</span>
      <span class="pb-meta">+RM {fmt(reimbursedTotal)}<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </button>
  {/if}

  <div class="card" data-guide="loan-log-card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; cursor:pointer;" onclick={() => (loanLogOpen = true)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (loanLogOpen = true)}>
    <div>
      <div style="font-size:11.5px; color:var(--lo); font-weight:600;">Loan log</div>
      {#if loanList.length}
        <div style="display:flex; gap:14px; margin-top:2px;">
          <div><span class="num" style="font-size:17px; font-weight:700; color:var(--good);">RM {fmt(loanLent)}</span><div style="font-size:10.5px; color:var(--dim);">you lent</div></div>
          <div><span class="num" style="font-size:17px; font-weight:700; color:var(--red);">RM {fmt(loanOwed)}</span><div style="font-size:10.5px; color:var(--dim);">you owe</div></div>
        </div>
      {:else}
        <div class="num" style="font-size:19px; font-weight:700; margin-top:2px; color:var(--dim);">No loans logged</div>
      {/if}
      <div style="font-size:11px; color:var(--dim); margin-top:6px;">Manual record — doesn't affect your balance</div>
    </div>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="color:var(--dim); flex-shrink:0;"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>

  <div class="section-hd" data-guide="commitments-section">
    <h3>Commitments</h3>
    <span>Planned RM {fmt(plannedTotal)}</span>
  </div>
  <div class="card">
    {#each month.categories as cat (cat.key)}
      {@const info = rowInfo(cat)}
      {@const leftover = cat.locked ? cat.lockedLeftover : null}
      <div class="cat-row" class:locked-row={cat.locked} onclick={() => (detailCategoryKey = cat.key)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (detailCategoryKey = cat.key)}>
        <span class="dot" style="background:{cat.color}"></span>
        <div class="cat-body">
          <div class="cat-name-row">
            <span>{cat.name}</span>
            <span class="cat-amt"><b class="num">RM {fmt(cat.actual)}</b> / {fmt(cat.planned)}</span>
          </div>
          <div class="track"><div class="fill" style="width:{info.pct}%; background:{info.over ? 'var(--red)' : cat.color}"></div></div>
          {#if cat.locked}
            <span class="cat-note" style="color:var(--gold);">
              Locked · {leftover >= 0 ? `RM ${fmt(leftover)} sent to Buffer` : `RM ${fmt(Math.abs(leftover))} pulled from Buffer`}
            </span>
          {:else if cat.key === 'saving'}
            <span class="cat-note link" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); currentView.set('goals'); }} onkeydown={(e) => e.key === 'Enter' && currentView.set('goals')}>Feeds your Goals pool &rarr;</span>
          {:else}
            <span class="cat-note" class:over={info.over} class:under={!info.over}>
              {info.over ? `Over by RM ${fmt(cat.actual - cat.planned)}` : `RM ${fmt(cat.planned - cat.actual)} left`}
            </span>
          {/if}
        </div>
        <button class="lock-btn" aria-label={cat.locked ? 'Unlock category' : 'Lock category'} onclick={(e) => { e.stopPropagation(); toggleLock(cat.key); }}>
          {#if cat.locked}
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><rect x="5" y="11" width="14" height="9" rx="2" stroke="var(--gold)" stroke-width="1.6"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="var(--gold)" stroke-width="1.6" stroke-linecap="round"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><rect x="5" y="11" width="14" height="9" rx="2" stroke="var(--dim)" stroke-width="1.6"/><path d="M8 11V8a4 4 0 0 1 7.5-2" stroke="var(--dim)" stroke-width="1.6" stroke-linecap="round"/></svg>
          {/if}
        </button>
      </div>
    {/each}

    <div class="cat-row" data-guide="buffer-row" onclick={() => (bufferOpen = !bufferOpen)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (bufferOpen = !bufferOpen)}>
      <span class="dot" style="background:{BUFFER_COLOR}"></span>
      <div class="cat-body">
        <div class="cat-name-row">
          <span>Buffer</span>
          <span class="cat-amt"><b class="num">RM {fmt(bufferActual)}</b> / {fmt(bufferPlanned)}</span>
        </div>
        <div class="track"><div class="fill" style="width:{bufferInfo.pct}%; background:{bufferInfo.over ? 'var(--red)' : BUFFER_COLOR}"></div></div>
        <span class="cat-note" class:over={bufferInfo.over} class:under={!bufferInfo.over}>
          {bufferInfo.over ? `Over by RM ${fmt(bufferActual - bufferPlanned)}` : `RM ${fmt(bufferPlanned - bufferActual)} left · auto from income`}
        </span>
        {#if bufferGroups.length}
          <div class="buffer-sub" class:open={bufferOpen}>
            {#each bufferGroups as g (g.name)}
              <div class="item item-link" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); bufferLabel = g.name; }} onkeydown={(e) => e.key === 'Enter' && (bufferLabel = g.name)}>
                <span>{g.name} &rsaquo;</span><b>RM {fmt(g.total)}</b>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <button class="end-month-btn" onclick={onEndMonth}>
    <svg viewBox="0 0 24 24" fill="none"><path d="M5 21V4M5 4h11l-2 4 2 4H5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
    End {month.label} &amp; start next month
  </button>
{:else if tmpl}
  <h2 class="title">Welcome 👋</h2>
  <p class="sub">Let's set up your first month.</p>
  <div class="card">
    <div class="field-lbl" style="margin-top:0;">Income <span style="text-transform:none; letter-spacing:0; color:var(--dim); font-weight:600;">optional</span></div>
    <input class="note-input num" data-guide="ob-income" placeholder="0.00" inputmode="decimal" bind:value={obStartMoney} />
    <p class="hint" style="margin:4px 2px 14px;">How much money you're starting this month with in total — salary included, plus any savings or leftover you already have. Leave blank if it's just your salary.</p>

    <div class="field-lbl">Salary</div>
    <input class="note-input num" data-guide="ob-salary" placeholder="0.00" inputmode="decimal" bind:value={obSalary} />
    <p class="hint" style="margin:4px 2px 14px;">Your monthly salary — you can adjust this later in Settings (Income adjusts with it automatically).</p>

    <div class="field-lbl">Your name <span style="text-transform:none; letter-spacing:0; color:var(--dim); font-weight:600;">optional</span></div>
    <input class="note-input" data-guide="ob-name" placeholder="e.g. Wafiq" bind:value={obName} />
  </div>
  <p class="hint" style="margin:10px 4px;">Fixed categories (rent, phone bill, etc.) come pre-filled as a template — rename or adjust them anytime in Settings, except Saving, which is tied to the Goals page.</p>
  <button class="save-btn" data-guide="ob-start" onclick={startFirstMonth}>Start {MONTH_NAMES[new Date().getMonth()]}</button>
{:else}
  <p class="sub">Loading...</p>
{/if}

<CategoryDetailSheet open={detailCategoryKey != null} category={detailCategory} onClose={() => (detailCategoryKey = null)} />
<BufferDetailSheet open={bufferLabel != null} label={bufferLabel} onClose={() => (bufferLabel = null)} />
<ReimbursementsSheet open={reimburseOpen} onClose={() => (reimburseOpen = false)} />
<LoanLogSheet open={loanLogOpen} onClose={() => (loanLogOpen = false)} />

<style>
  .lock-btn {
    background: none;
    border: none;
    padding: 4px;
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: 2px;
  }
  .lock-btn svg {
    transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .lock-btn:active svg {
    transform: scale(0.82);
  }
  .cat-row {
    transition: opacity 0.3s ease;
  }
  .locked-row {
    opacity: 0.85;
  }
  .item-link {
    cursor: pointer;
  }
  .item-link span {
    color: var(--gold);
  }
  .paidback-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: var(--panel);
    border: 2px solid var(--good);
    border-radius: 16px;
    box-shadow: 3px 3px 0 var(--good);
    padding: 14px 16px;
    margin-bottom: 16px;
    color: var(--hi);
    font-size: 14px;
    font-weight: 700;
    font-family: var(--body);
  }
  .paidback-row .pb-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--good);
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 700;
  }
</style>
