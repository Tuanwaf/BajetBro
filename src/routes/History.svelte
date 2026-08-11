<script>
  import { closedMonths, currentMonth, goals } from '../lib/stores.js';
  import { computeBufferActual, computeSpentTotal, computeBankFreeTotal, allocIsReserved, spendRM, round2 } from '../lib/calc.js';
  import { banks as bankPreviewStore } from '../lib/bankPreviewStore.js';

  function groupExtras(extras) {
    const map = new Map();
    for (const e of extras || []) map.set(e.name, round2((map.get(e.name) || 0) + (e.actual || 0)));
    return [...map.entries()].map(([name, total]) => ({ name, total }));
  }
  import { fmt, formatDate } from '../lib/format.js';
  import { BUFFER_COLOR } from '../lib/constants.js';

  let closed = $derived($closedMonths ?? []);
  let month = $derived($currentMonth);
  let goalList = $derived($goals ?? []);
  // The real, live "how much do I actually have" figure -- see
  // computeBankFreeTotal's comment in calc.js. Used below only for the
  // current (still-open) month's Monthly-log delta -- see allMonths.
  let liveTotal = $derived(computeBankFreeTotal($bankPreviewStore));

  // Daily spending -- browsed one WEEK at a time (7 bars, prev/next
  // arrows), covering every month ever tracked (closed + current), never
  // reset at End Month. Built from itemized, dated entries: category
  // transactions + Buffer extras (gross amounts), plus money given away to
  // a goal or spent out of a goal's own reserve -- all real spending, gone
  // from a real bank exactly like a category expense. A contribution that
  // STAYS reserved (whether in the same bank or moved to another one) isn't
  // spending at all, so it's deliberately left out, same as
  // computeBankActivity's own `neutral` distinction (via allocIsReserved).
  // A category's `actual` can be higher than the sum of its own
  // `transactions` for months tracked before per-entry dates existed (see
  // CategoryDetailSheet's own "only the total is on record" case) -- those
  // untracked amounts have no day to attach to, so they're honestly left
  // out rather than guessed at, the same way CategoryDetailSheet does for
  // that same data. Same applies to goal allocations dated only to a month
  // ("2026-04", not a full ISO date) -- too coarse to attach to one day.
  //
  // Scanning every month up front (rather than per-week) is simpler than it
  // sounds: a week can straddle a month boundary, so there's no single
  // month document to scope this to anyway -- easiest to just build one
  // lookup map from everything, then read out whichever 7 keys the current
  // week window needs.
  let dailyMap = $derived.by(() => {
    const map = new Map();
    const add = (date, amount, note, color) => {
      if (!date || date.length < 10) return;
      const key = date.slice(0, 10);
      const day = map.get(key) || { total: 0, entries: [] };
      day.total = round2(day.total + amount);
      day.entries.push({ note, amount, color });
      map.set(key, day);
    };
    for (const m of month ? [...closed, month] : closed) {
      for (const cat of m.categories || []) {
        for (const tx of cat.transactions || []) add(tx.date, tx.amount, tx.note || cat.name, cat.color);
      }
      for (const e of m.extras || []) {
        add(e.date, round2((e.actual || 0) + (e.reimbursed || 0)), e.note || e.name, BUFFER_COLOR);
      }
    }
    for (const g of goalList) {
      for (const a of g.allocations || []) {
        if (allocIsReserved(g, a) || a.amount <= 0) continue;
        add(a.date, a.amount, a.note || `Given to ${g.label}`, g.color);
      }
      for (const s of g.spends || []) {
        add(s.date, spendRM(g, s), s.label || `Spent · ${g.label}`, g.color);
      }
    }
    return map;
  });

  // Monday-start week containing `date`, at UTC midnight -- everything here
  // stays in UTC terms throughout (see the note on dailyDays below for why
  // mixing in local-time Date parsing is what broke this before).
  function startOfWeekUTC(date) {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const mondayOffset = (d.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
    d.setUTCDate(d.getUTCDate() - mondayOffset);
    return d;
  }

  let weekOffset = $state(0); // 0 = the week containing today; negative = further back
  function shiftWeek(delta) {
    weekOffset += delta;
    selectedDayKey = null;
  }

  let weekStart = $derived.by(() => {
    const d = startOfWeekUTC(new Date());
    d.setUTCDate(d.getUTCDate() + weekOffset * 7);
    return d;
  });
  let weekEnd = $derived.by(() => {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + 6);
    return d;
  });
  let weekRangeLabel = $derived.by(() => {
    const sameMonth = weekStart.getUTCMonth() === weekEnd.getUTCMonth() && weekStart.getUTCFullYear() === weekEnd.getUTCFullYear();
    const startStr = weekStart.toLocaleDateString('en-MY', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
    const endStr = weekEnd.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${startStr} – ${endStr}`;
  });

  // Exactly 7 days, Monday through Sunday, for the current week window --
  // including zero-spend days, so a real bar chart reads by its spacing
  // along time rather than a sparse list of "days something happened".
  // Every key here is built and walked in UTC, never local time: `tx.date`
  // is a full UTC ISO string, so slicing its first 10 chars already gives
  // a UTC calendar day for dailyMap's keys above -- Date.UTC keeps this
  // walk in those same UTC terms (mixing in local-time Date parsing here
  // previously shifted every key backward a full day in any timezone
  // ahead of UTC).
  let dailyDays = $derived.by(() => {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const day = dailyMap.get(key);
      out.push({ key, weekday: d.toLocaleDateString('en-MY', { weekday: 'short' }), dayNum: d.getUTCDate(), total: day?.total || 0, entries: day?.entries || [] });
    }
    return out;
  });
  let dailyMax = $derived(Math.max(1, ...dailyDays.map((d) => d.total)));

  // Square-root (not linear) scaling: a day at 5% of the week's biggest
  // total would render as an almost invisible 5px sliver on a linear scale,
  // barely there to look at or tap -- sqrt lifts small-but-real days
  // noticeably higher (5% -> ~22% height) while still keeping the biggest
  // day tallest, so one outlier spend (e.g. rent + savings + a transfer,
  // all settled the day salary lands) doesn't flatten every quieter day
  // into nothing. MIN_BAR_PX is a further floor under that, purely for
  // legibility on genuinely tiny days.
  const MAX_BAR_PX = 90;
  const MIN_BAR_PX = 16;
  function barHeight(total, max) {
    if (total <= 0) return 3;
    return Math.max(MIN_BAR_PX, Math.sqrt(total / max) * MAX_BAR_PX);
  }

  let selectedDayKey = $state(null);
  // Defaults to today if it's in the visible week, else the most recent day
  // that actually had spending, else just the last day -- so the detail
  // panel shows something relevant rather than an empty future day.
  let selectedDay = $derived.by(() => {
    if (selectedDayKey) {
      const found = dailyDays.find((d) => d.key === selectedDayKey);
      if (found) return found;
    }
    const todayKey = new Date().toISOString().slice(0, 10);
    return (
      dailyDays.find((d) => d.key === todayKey) ??
      [...dailyDays].reverse().find((d) => d.total > 0) ??
      dailyDays.at(-1) ??
      null
    );
  });

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
      // A closed month's delta is a frozen historical fact (Income minus
      // Spent, exactly as always) -- correct as-is. The CURRENT month's
      // "what's left" instead has to read straight off the real bank total
      // (liveTotal, see computeBankFreeTotal), same fix as Home's Buffer --
      // primaryValue still comes from the old startingBalance chain, which
      // has no idea a Transfer or a goal contribution/withdrawal ever
      // happened, so it drifts from reality the moment one does.
      const delta = r.current ? liveTotal : round2(primaryValue + reimbursed - r.spend);
      return {
        ...r,
        primaryLabel: hasBalance ? 'Income' : 'Salary',
        primaryValue,
        reimbursed,
        delta,
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

<div class="card" data-guide="history-ring" style="margin-bottom:18px;">
  <div class="ring-wrap">
    <div class="ring" style={ringGradient ? `background:conic-gradient(${ringGradient})` : 'background:var(--panel-2)'}>
      <div class="mid"><div class="k">Spent</div><div class="v">{fmt(ringTotal)}</div></div>
    </div>
    <div class="legend">
      {#if ringItems.length}
        {#each ringItems as i (i.name)}
          <div class="row"><span class="name"><span class="dot" style="background:{i.color}"></span>{i.name}</span><b>{fmt(i.spent)}</b></div>
        {/each}
      {:else}
        <div class="row" style="color:var(--dim);">No spending logged yet this month.</div>
      {/if}
    </div>
  </div>
</div>

<div class="section-hd"><h3>Daily spending</h3></div>
<div class="card" data-guide="history-daily" style="margin-bottom:18px;">
  <div class="week-nav">
    <button class="week-arrow" aria-label="Previous week" onclick={() => shiftWeek(-1)}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 1 3 7l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <span class="week-label">{weekRangeLabel}</span>
    <button class="week-arrow" aria-label="Next week" disabled={weekOffset >= 0} onclick={() => shiftWeek(1)}>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M5 1l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
  <div class="daily-bars">
    {#each dailyDays as d (d.key)}
      <button
        class="daily-bar-col"
        aria-label={`${formatDate(d.key)}, RM ${fmt(d.total)}`}
        onclick={() => (selectedDayKey = d.key)}
      >
        <span
          class="daily-bar"
          class:selected={selectedDay?.key === d.key}
          class:empty={d.total <= 0}
          style="height:{barHeight(d.total, dailyMax)}px"
        ></span>
        <span class="day-label">{d.weekday}<br />{d.dayNum}</span>
      </button>
    {/each}
  </div>
  {#if selectedDay}
    <div class="daily-detail">
      <div class="daily-detail-hd">
        <span class="date">{formatDate(selectedDay.key)}</span>
        <span class="num total" style="color:{selectedDay.total > 0 ? 'var(--red)' : 'var(--dim)'};">
          {selectedDay.total > 0 ? `RM ${fmt(selectedDay.total)}` : 'No spending'}
        </span>
      </div>
      {#each selectedDay.entries as e, i (i)}
        <div class="daily-entry">
          <span class="dot" style="background:{e.color}"></span>
          <span class="name">{e.note}</span>
          <span class="num">RM {fmt(e.amount)}</span>
        </div>
      {:else}
        {#if selectedDay.total <= 0}
          <p class="hint" style="margin:2px 0;">Nothing logged this day.</p>
        {/if}
      {/each}
    </div>
  {/if}
  <p class="hint" style="margin:10px 4px 0;">Tap a bar to see that day's breakdown — use the arrows above to look back through every week you've ever tracked, even past End Month.</p>
</div>

<div class="section-hd"><h3>Monthly log</h3><span>Income vs spent</span></div>
<div class="card" data-guide="history-log">
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

  .week-nav {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 10px;
  }
  .week-arrow {
    background: var(--panel-2); border: 2px solid var(--stroke-2); border-radius: 50%;
    width: 30px; height: 30px; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    color: var(--hi);
  }
  .week-arrow:disabled { opacity: 0.35; }
  .week-label { font-size: 13px; font-weight: 700; color: var(--lo); }

  /* One flex column per day of the 7-day week -- always exactly 7, so
     (unlike the old whole-month version) there's room for each bar to be
     wide and for a weekday/day-number label underneath, without ever
     needing to scroll. Bottom-anchored via align-items:flex-end on the row
     so every bar's baseline lines up regardless of height. */
  .daily-bars {
    display: flex; align-items: flex-end; justify-content: space-between;
    height: 130px;
    padding: 2px 0 0;
  }
  .daily-bar-col {
    background: none; border: none; padding: 0;
    width: 13.5%; height: 100%; flex-shrink: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: flex-end;
    gap: 4px;
  }
  .daily-bar {
    width: 60%; min-width: 20px; border-radius: 4px 4px 1px 1px;
    background: var(--red);
    opacity: 0.45;
    transition: opacity 0.15s;
  }
  .day-label {
    font-size: 9.5px; line-height: 1.3; color: var(--dim); font-weight: 600;
    text-align: center; text-transform: uppercase;
  }
  .daily-bar.empty { background: var(--stroke-2); opacity: 1; }
  .daily-bar.selected { opacity: 1; }

  .daily-detail { margin-top: 12px; padding-top: 10px; border-top: 1px solid var(--stroke); }
  .daily-detail-hd { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .daily-detail-hd .date { font-size: 12.5px; font-weight: 700; color: var(--lo); }
  .daily-detail-hd .total { font-weight: 700; }
  .daily-entry { display: flex; align-items: center; gap: 8px; padding: 5px 2px; font-size: 12.5px; color: var(--hi); }
  .daily-entry .name { flex: 1; min-width: 0; }
</style>
