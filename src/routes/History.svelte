<script>
  import { closedMonths, currentMonth } from '../lib/stores.js';
  import { computeBufferActual, computeSpentTotal, round2 } from '../lib/calc.js';

  function groupExtras(extras) {
    const map = new Map();
    for (const e of extras || []) map.set(e.name, round2((map.get(e.name) || 0) + (e.actual || 0)));
    return [...map.entries()].map(([name, total]) => ({ name, total }));
  }
  import { fmt } from '../lib/format.js';
  import { BUFFER_COLOR } from '../lib/constants.js';

  let closed = $derived($closedMonths ?? []);
  let month = $derived($currentMonth);

  let ringItems = $derived.by(() => {
    if (!month) return [];
    const items = month.categories
      .map((c) => ({ name: c.name, color: c.color, spent: c.actual }))
      .concat([{ name: 'Buffer', color: BUFFER_COLOR, spent: computeBufferActual(month) }])
      .filter((i) => i.spent > 0)
      .sort((a, b) => b.spent - a.spent);
    return items;
  });
  let ringTotal = $derived(ringItems.reduce((s, i) => s + i.spent, 0));
  let ringGradient = $derived.by(() => {
    if (ringTotal <= 0) return null;
    let acc = 0;
    return ringItems
      .map((i) => {
        const start = acc;
        acc += (i.spent / ringTotal) * 100;
        return `${i.color} ${start}% ${acc}%`;
      })
      .join(', ');
  });

  let allMonths = $derived.by(() => {
    const rows = closed.map((m) => ({
      key: m.key,
      name: m.label,
      salary: m.income,
      bonus: m.bonus || 0,
      additionalIncome: m.additionalIncome || 0,
      startingBalance: m.startingBalance,
      spend: m.recordedTotal,
      categories: m.categories,
      extras: m.extras,
      reimbursements: m.reimbursements || [],
      current: false,
    }));
    if (month) {
      rows.push({
        key: month.key,
        name: month.label,
        salary: month.income,
        bonus: month.bonus || 0,
        additionalIncome: month.additionalIncome || 0,
        startingBalance: month.startingBalance,
        spend: computeSpentTotal(month),
        categories: month.categories,
        extras: month.extras,
        reimbursements: month.reimbursements || [],
        current: true,
      });
    }
    return rows.map((r) => {
      // Falls back to Salary for the first tracked month, which predates
      // rolling-balance tracking and has no Income figure of its own.
      // Income already has that month's salary folded in, so unlike the
      // Salary fallback, it only needs bonus/additional income added.
      const hasBalance = r.startingBalance != null;
      const primaryValue = hasBalance
        ? r.startingBalance + r.bonus + r.additionalIncome
        : r.salary + r.bonus + r.additionalIncome;
      const reimbursed = (r.reimbursements || []).reduce((s, x) => s + (x.amount || 0), 0);
      return {
        ...r,
        primaryLabel: hasBalance ? 'Income' : 'Salary',
        primaryValue,
        reimbursed,
        delta: primaryValue + reimbursed - r.spend,
      };
    });
  });

  let expandedKey = $state(null);
  function toggle(key) {
    expandedKey = expandedKey === key ? null : key;
  }
</script>

<h2 class="title">History</h2>
<p class="sub">Every month, rolled forward automatically.</p>

<div class="card" style="margin-bottom:18px;">
  <div class="ring-wrap">
    <div class="ring" style={ringGradient ? `background:conic-gradient(${ringGradient})` : 'background:var(--panel-2)'}>
      <div class="mid"><div class="k">Spent</div><div class="v">{fmt(ringTotal)}</div></div>
    </div>
    <div class="legend">
      {#if ringItems.length}
        {#each ringItems.slice(0, 4) as i (i.name)}
          <div class="row"><span class="name"><span class="dot" style="background:{i.color}"></span>{i.name}</span><b>{fmt(i.spent)}</b></div>
        {/each}
      {:else}
        <div class="row" style="color:var(--dim);">No spending logged yet this month.</div>
      {/if}
    </div>
  </div>
</div>

<div class="section-hd"><h3>Monthly log</h3><span>Income vs spent</span></div>
<div class="card">
  {#each allMonths as m (m.key)}
    <div class="month-row" class:open={expandedKey === m.key} onclick={() => toggle(m.key)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && toggle(m.key)}>
      <div class="month-row-info">
        <div class="name">{m.name}{m.current ? ' · current' : ''}</div>
        <div class="sub2">{m.primaryLabel} RM {fmt(m.primaryValue)}</div>
        <div class="sub2">Spent RM {fmt(m.spend)}</div>
      </div>
      <div class="right">
        <span class="pill" class:good={m.delta >= 0} class:bad={m.delta < 0}>{m.delta >= 0 ? '+' : '-'}RM {fmt(Math.abs(m.delta))}</span>
        <svg class="chev" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
    </div>
    <div class="month-detail" class:open={expandedKey === m.key}>
      <div class="detail-figures">
        <span>Salary <b class="num">RM {fmt(m.salary)}</b>{#if m.bonus > 0}<b class="num" style="color:var(--good);"> +{fmt(m.bonus)}</b>{/if}</span>
        {#if m.startingBalance != null}
          <span>Income <b class="num">RM {fmt(m.primaryValue)}</b>{#if m.additionalIncome > 0}<b class="num" style="color:var(--good);"> +{fmt(m.additionalIncome)}</b>{/if}</span>
        {/if}
        {#if m.reimbursed > 0}
          <span>Paid back <b class="num" style="color:var(--good);">+RM {fmt(m.reimbursed)}</b></span>
        {/if}
      </div>
      {#each m.categories as cat (cat.key)}
        <div class="detail-row">
          <span class="dot" style="background:{cat.color}"></span>
          <span class="name">{cat.name}{#if cat.note}<em class="note"> ({cat.note})</em>{/if}</span>
          <span class="num">RM {fmt(cat.actual)}</span>
        </div>
      {/each}
      {#each groupExtras(m.extras) as extra (extra.name)}
        <div class="detail-row">
          <span class="dot" style="background:{BUFFER_COLOR}"></span>
          <span class="name">{extra.name}</span>
          <span class="num">RM {fmt(extra.total)}</span>
        </div>
      {/each}
    </div>
  {:else}
    <p class="hint" style="margin:4px 0;">No months tracked yet.</p>
  {/each}
</div>

<style>
  .month-row-info {
    flex: 1;
    min-width: 0;
  }
  .month-row .right {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .detail-figures {
    display: flex;
    gap: 16px;
    font-size: 12px;
    color: var(--lo);
    padding: 6px 4px 10px;
    border-bottom: 1px solid var(--stroke);
    margin-bottom: 4px;
  }
  .detail-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
    font-size: 13px;
    color: var(--hi);
  }
  .detail-row .name {
    flex: 1;
  }
  .detail-row .note {
    color: var(--dim);
    font-size: 11px;
    font-style: italic;
  }
</style>
