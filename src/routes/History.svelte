<script>
  import { closedMonths, currentMonth, goals } from '../lib/stores.js';
  import { computeBufferActual, computeSpentTotal, computeBankFreeTotal, allocIsReserved, spendRM, inCycle, round2 } from '../lib/calc.js';
  import { banks as bankPreviewStore, computeBankActivity, computeBankReservedAsOf } from '../lib/bankPreviewStore.js';

  function groupExtras(extras) {
    const map = new Map();
    for (const e of extras || []) map.set(e.name, round2((map.get(e.name) || 0) + (e.actual || 0)));
    return [...map.entries()].map(([name, total]) => ({ name, total }));
  }
  import { fmt, formatDate, toLocalDateKey } from '../lib/format.js';
  import { BUFFER_COLOR, getCardDesign, cardBorderColor } from '../lib/constants.js';
  import BankIcon from '../lib/components/BankIcon.svelte';
  import CardPattern from '../lib/components/CardPattern.svelte';

  let closed = $derived($closedMonths ?? []);
  let month = $derived($currentMonth);
  let goalList = $derived($goals ?? []);
  let banksList = $derived($bankPreviewStore ?? []);
  // The real, live "how much do I actually have" figure -- see
  // computeBankFreeTotal's comment in calc.js. Used below only for the
  // current (still-open) month's Monthly-log delta -- see allMonths.
  let liveTotal = $derived(computeBankFreeTotal($bankPreviewStore));
  // Money set aside for goals right now, across every bank -- same live,
  // not-month-scoped snapshot bankBreakdown's own per-bank cards already
  // use (a goal reservation has no per-month history of its own, so
  // there's nothing more precise to show for a closed month anyway).
  let totalReserved = $derived(round2(banksList.reduce((s, b) => s + (b.reserved || 0), 0)));

  // Chronological order (closed months by key, then the current month
  // last) -- needed to walk a bank's live balance backward to what it held
  // at the START of any given month, since bankBreakdown below wants a
  // per-bank echo of the overall row's own "Income" (a rolled-forward
  // starting total, not this month's fresh activity) -- see
  // bankStartingBalance.
  let monthsChron = $derived([...closed].sort((a, b) => a.key.localeCompare(b.key)).concat(month ? [month] : []));

  // The TRUE net change to a bank's real balance for one month -- every
  // entry computeBankActivity returns already corresponds 1:1 to a real
  // adjustBankBalance call (see bankPreviewStore.js), including the
  // `neutral` ones (transfers, a goal reserved in a DIFFERENT bank) --
  // `neutral` only means "don't count this in the Income/Spending
  // headline stats," not "this didn't really move the balance." Summing
  // computeBankActivity's own `income`/`spending` totals would silently
  // drop every transfer, which is exactly the gap that made Start/Spent
  // not reconcile against the real balance -- summing the raw entries by
  // their own `income` flag instead counts every real movement once.
  //
  // `+ e.reimbursed` on top of that: marking a category/buffer entry paid
  // back (CategoryDetailSheet/BufferDetailSheet) credits the bank for
  // real (see their commitEdit/saveEdit), but the entry itself still shows
  // its original gross `amount` with no separate record of that credit --
  // there's no second dated entry for it, just a `reimbursed` field bolted
  // onto the same one. Without adding it back here, a reimbursed spend
  // would look like it still drained the full gross amount, understating
  // Start by exactly what got credited back. This assumes the credit
  // landed in the same month as the original entry, which holds for the
  // common case (spent and got paid back within the same still-open
  // cycle) but can't be exact for one reimbursed in a LATER cycle than the
  // original spend -- the data model has no separate timestamp for when
  // the "paid back" edit itself happened, only the entry's original date.
  function bankNetMovement(month, bankId) {
    const activity = computeBankActivity(month, goalList, bankId);
    return round2(activity.transactions.reduce((s, e) => s + (e.income ? e.amount : -e.amount) + (e.reimbursed || 0), 0));
  }

  // A bank's balance at the START of a given month -- same idea as the
  // whole pool's own `startingBalance` (the rolled-forward total before
  // that cycle's own activity), reconstructed per bank since a bank's
  // balance is only ever stored as one live "now" number, never a
  // per-month snapshot. Works backward from the bank's CURRENT live
  // balance, undoing every month's own net movement from the target month
  // through to now.
  function bankStartingBalance(row, bankId, liveBalance) {
    const idx = monthsChron.findIndex((mo) => mo.key === row.key);
    if (idx === -1) return liveBalance;
    let net = 0;
    for (let i = idx; i < monthsChron.length; i++) net += bankNetMovement(monthsChron[i], bankId);
    return round2(liveBalance - net);
  }

  // A bank's balance at the END of a given month -- same backward walk as
  // bankStartingBalance, just stopping one month later (undoing everything
  // AFTER this row, not including it). For the current/open row that's
  // simply the bank's live balance right now, since there's nothing after
  // it to undo yet.
  function bankEndingBalance(row, bankId, liveBalance) {
    const idx = monthsChron.findIndex((mo) => mo.key === row.key);
    if (idx === -1) return liveBalance;
    let net = 0;
    for (let i = idx + 1; i < monthsChron.length; i++) net += bankNetMovement(monthsChron[i], bankId);
    return round2(liveBalance - net);
  }

  // Per-bank breakdown for one Monthly-log row: Start (see
  // bankStartingBalance) + this month's own Spending (computeBankActivity
  // already gives exactly this). For the CURRENT month, every existing
  // bank shows even with zero activity yet -- that's the whole point while
  // testing/setting one up, you want to see it listed before you've logged
  // anything through it. A closed month instead only lists banks that had
  // activity right then -- a bank added later in the app's life didn't
  // exist yet in an old month, so it's left out rather than shown with a
  // meaningless backward-extrapolated number.

  // Whether a month's category spending is itemized completely enough for
  // the per-bank breakdown below to mean anything. Some real months in this
  // app's own history (tracked before multi-bank -- or, further back,
  // before this app at all, just carried forward as a manual total) have a
  // category's `actual` with few or no matching `transactions` entries --
  // that untracked slice has no bankId to attribute to any specific bank.
  // bankStartingBalance/bankNetMovement only ever see the ITEMIZED slice,
  // so for a month like this the "per bank" reconstruction silently treats
  // the untracked spending as if it never happened to any bank's real
  // balance -- which is wrong, not just incomplete, since it makes an old
  // month's Start look inflated by exactly however much went untracked.
  // Rather than show a number that's actively misleading, the per-bank
  // section is skipped entirely for a month that fails this check (see the
  // markup) -- Income/Spent at the top of the row are unaffected, since
  // those come straight from the month's own recorded totals, not this
  // reconstruction.
  function monthHasCompleteBankTagging(month) {
    for (const c of month.categories || []) {
      const trackedNet = round2(
        (c.transactions || []).reduce((s, t) => s + round2((t.amount || 0) - (t.reimbursed || 0)), 0)
      );
      if (Math.abs(trackedNet - round2(c.actual || 0)) > 0.01) return false;
    }
    return true;
  }

  function bankBreakdown(row) {
    return banksList
      .map((b) => {
        const activity = computeBankActivity(row.raw, goalList, b.bank.id);
        const additionalIncome = round2(
          (row.raw.additionalIncomeLog || []).reduce((s, e) => (e.bankId === b.bank.id ? s + (e.amount || 0) : s), 0)
        );
        // Transfers split by direction, not netted -- netting them together
        // would hide an "in" and an "out" that both happened this month
        // behind a single number. Neither side folds into Start's own
        // income bolt-on (see startIncoming below) -- your own money moving
        // between your own banks was never income, just relocating; both
        // directions instead sit together under "Sent" (the out amount as
        // its headline figure, the in amount as its own dim sub-line,
        // mirroring how Spent shows its own goals sub-line), so a transfer
        // is trackable as exactly what it is rather than quietly inflating
        // how much Start looks like it grew from real income this cycle.
        const transferIn = round2(
          activity.transactions.filter((e) => e.source?.kind === 'transfer' && e.income).reduce((s, e) => s + e.amount, 0)
        );
        const transferOut = round2(
          activity.transactions.filter((e) => e.source?.kind === 'transfer' && !e.income).reduce((s, e) => s + e.amount, 0)
        );
        // The dedicated "Paid back to you" quick-add (AddExpenseSheet's
        // `reimburse` branch) -- genuinely new money landing in this bank,
        // same as Additional income/a transfer-in, so it folds into Start
        // the same way. NOT the same thing as marking an existing
        // category/buffer entry paid back (that one only reduces Spending
        // and restores Balance -- see bankNetMovement's comment -- it was
        // never really new income, just an expense reversing itself).
        const reimbursementsReceived = round2(
          (row.raw.reimbursements || []).reduce((s, r) => (r.bankId === b.bank.id ? s + (r.amount || 0) : s), 0)
        );
        // Salary (+ bonus) landing at cycle start (see EndMonthSheet) is the
        // same kind of credit as Additional income/a reimbursement -- real
        // money that showed up in this bank early in the cycle, which the
        // overall row's own "Income" figure already counts as part of this
        // cycle's total. computeBankActivity's salaryCredit entry makes
        // bankNetMovement/bankStartingBalance correctly see it (so Balance
        // and every OTHER month's own reconstruction stay right), but that
        // same visibility means it also gets subtracted out of trueStart
        // below along with everything else this cycle -- so it has to be
        // added back here too, exactly like additionalIncome/
        // reimbursementsReceived already are, or Start would understate
        // this bank's true starting figure by the whole salary amount.
        const salaryCredited =
          row.raw.salaryCredit && row.raw.salaryCredit.bankId === b.bank.id ? row.raw.salaryCredit.amount || 0 : 0;
        // Same shape as the overall row's own "Income RM X +Y": the base
        // number is fully inclusive (bankStartingBalance is the balance
        // BEFORE any of this cycle's own activity, including this), and the
        // +Y bolt-on is a decorative breakdown of how much of that total
        // came in mid-cycle as genuine income -- not something to add again
        // by hand. Deliberately excludes transferIn (see its own comment
        // above) -- a transfer is real money that moved, so it's still
        // folded into trueStart/trueEnd's own backward reconstruction
        // (bankNetMovement counts every real movement regardless of the
        // neutral flag), it's just not counted as INCOME the way this
        // bolt-on's color/framing implies.
        //
        // Fixed deposit AND goal-reserved money are both subtracted out of
        // both Start and Balance -- computeBankFreeTotal (what Income is
        // ultimately anchored to, via adjustCycleBaseline and EndMonthSheet)
        // excludes both the exact same way: locked money and money already
        // earmarked for a goal are neither one "free." Reserved gets its own
        // POINT-IN-TIME value for each side, though -- unlike Fixed deposit
        // (a bare field with no history of its own, so it really can only
        // ever be today's value), a goal reservation is dated, so
        // computeBankReservedAsOf can answer "how much was reserved as of
        // the START vs. the END of this specific row" separately. Using a
        // single current snapshot for both sides (the old approach) made a
        // reservation made mid-cycle look like it had already been reserved
        // before that cycle even began, understating that row's Start by
        // exactly the reserved amount -- which is exactly what threw off a
        // manual "sum every bank's Start" check against the real Income
        // figure. reservedAtStart uses the PREVIOUS row's own key as its
        // cutoff (nothing before the very first tracked month), so a
        // reservation dated inside THIS row's own cycle is correctly
        // excluded from Start but still included in Balance.
        const idx = monthsChron.findIndex((mo) => mo.key === row.key);
        const prevRowKey = idx > 0 ? monthsChron[idx - 1].key : null;
        const reservedAtStart = prevRowKey ? computeBankReservedAsOf(goalList, b.bank.id, prevRowKey) : 0;
        const reservedAtEnd = computeBankReservedAsOf(goalList, b.bank.id, row.key);
        const fixedDeposit = b.fixedDeposit || 0;
        const lockedStart = round2(fixedDeposit + reservedAtStart);
        const lockedEnd = round2(fixedDeposit + reservedAtEnd);
        const trueStart = round2(bankStartingBalance(row, b.bank.id, b.balance) - lockedStart);
        const trueEnd = round2(bankEndingBalance(row, b.bank.id, b.balance) - lockedEnd);
        const startIncoming = round2(additionalIncome + reimbursementsReceived + salaryCredited);
        return {
          id: b.bank.id,
          bank: b.bank,
          startBalance: round2(trueStart + startIncoming),
          startIncoming,
          endBalance: trueEnd,
          fixedDeposit,
          reserved: reservedAtEnd,
          transferOut,
          transferIn,
          spending: activity.spending,
          hasActivity: activity.income > 0 || activity.spending > 0 || transferIn !== 0 || transferOut !== 0,
        };
      })
      .filter((b) => b.hasActivity || row.current);
  }

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
      const key = toLocalDateKey(date);
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
        // A `starting` allocation is what the goal already had before it
        // was ever tracked here -- not a real spend that happened on that
        // date, even for one marked "given away" (see the New Goal sheet's
        // "Already given away" option). Counting it would inflate a day's
        // spending with money that was never really given away *today*.
        if (a.starting) continue;
        if (allocIsReserved(g, a) || a.amount <= 0) continue;
        add(a.date, a.amount, a.note || `Given to ${g.label}`, g.color);
      }
      for (const s of g.spends || []) {
        add(s.date, spendRM(g, s), s.label || `Spent · ${g.label}`, g.color);
      }
    }
    return map;
  });

  // Monday-start week containing `date`, at LOCAL midnight -- everything
  // here stays in local terms throughout, matching dailyMap's keys above
  // (also local, via toLocalDateKey). These two used to each pick a
  // different timezone (dailyMap's keys were always the UTC calendar day of
  // the stored ISO instant, while this side used local Date math), which
  // silently shifted every lookup a full day for entries near local
  // midnight in any timezone ahead of UTC -- e.g. a 3am entry in Malaysia
  // (UTC+8) landing under the previous day. Keeping both sides local fixes
  // that; mixing UTC and local Date math anywhere in this file reintroduces
  // it, so don't.
  function startOfWeekLocal(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const mondayOffset = (d.getDay() + 6) % 7; // Mon=0 ... Sun=6
    d.setDate(d.getDate() - mondayOffset);
    return d;
  }

  let weekOffset = $state(0); // 0 = the week containing today; negative = further back
  function shiftWeek(delta) {
    weekOffset += delta;
    selectedDayKey = null;
  }

  let weekStart = $derived.by(() => {
    const d = startOfWeekLocal(new Date());
    d.setDate(d.getDate() + weekOffset * 7);
    return d;
  });
  let weekEnd = $derived.by(() => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + 6);
    return d;
  });
  let weekRangeLabel = $derived.by(() => {
    const sameMonth = weekStart.getMonth() === weekEnd.getMonth() && weekStart.getFullYear() === weekEnd.getFullYear();
    const startStr = weekStart.toLocaleDateString('en-MY', sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
    const endStr = weekEnd.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
    return `${startStr} – ${endStr}`;
  });

  // Exactly 7 days, Monday through Sunday, for the current week window --
  // including zero-spend days, so a real bar chart reads by its spacing
  // along time rather than a sparse list of "days something happened".
  let dailyDays = $derived.by(() => {
    const out = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      const key = toLocalDateKey(d);
      const day = dailyMap.get(key);
      out.push({ key, weekday: d.toLocaleDateString('en-MY', { weekday: 'short' }), dayNum: d.getDate(), total: day?.total || 0, entries: day?.entries || [] });
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
    const todayKey = toLocalDateKey(new Date());
    return (
      dailyDays.find((d) => d.key === todayKey) ??
      [...dailyDays].reverse().find((d) => d.total > 0) ??
      dailyDays.at(-1) ??
      null
    );
  });

  // Money given away to (or spent out of) a goal this cycle -- real,
  // permanent spending exactly like a category/buffer expense, but the
  // goal it came from has no idea it should show up here on its own (goals
  // are a separate top-level table, never nested inside `month`). One
  // slice per goal (its own color) rather than a single lump, same as
  // every category already gets its own slice -- mirrors this figure's
  // job (a per-source breakdown of where "Spent" came from).
  function goalGivenThisCycle(g) {
    let total = 0;
    for (const a of g.allocations || []) {
      if (a.starting || allocIsReserved(g, a)) continue;
      if (!inCycle(month, a.date, a.cycleMonth)) continue;
      total += a.amount || 0;
    }
    for (const s of g.spends || []) {
      if (!inCycle(month, s.date, s.cycleMonth)) continue;
      total += spendRM(g, s);
    }
    return round2(total);
  }
  let ringItems = $derived.by(() => {
    if (!month) return [];
    const items = month.categories
      .map((c) => ({ name: c.name, color: c.color, spent: c.actual }))
      .concat([{ name: 'Buffer', color: BUFFER_COLOR, spent: computeBufferActual(month) }])
      .concat(goalList.map((g) => ({ name: g.label, color: g.color, spent: goalGivenThisCycle(g) })))
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
      raw: m,
    }));
    if (month) {
      rows.push({
        key: month.key,
        name: month.label,
        salary: month.income,
        bonus: month.bonus || 0,
        additionalIncome: month.additionalIncome || 0,
        startingBalance: month.startingBalance,
        spend: computeSpentTotal(month, goalList),
        categories: month.categories,
        extras: month.extras,
        reimbursements: month.reimbursements || [],
        current: true,
        raw: month,
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
        {#if m.current && totalReserved > 0}
          <div class="sub2">Goals RM {fmt(totalReserved)}</div>
        {/if}
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
      {#if !m.current && !monthHasCompleteBankTagging(m.raw)}
        <p class="hint" style="margin:6px 4px;">Per-bank breakdown isn't available for this month — its spending wasn't tracked per bank at the time.</p>
      {:else if bankBreakdown(m).length}
        <div class="bank-figures-group">
          <div class="detail-hd">Per bank</div>
          <div class="bank-figure-scroll">
          {#each bankBreakdown(m) as b (b.id)}
            {@const design = getCardDesign(b.bank.design)}
            {@const borderColor = cardBorderColor(b.bank)}
            <div
              class="bank-figure-card"
              style="border-color:{borderColor}; box-shadow:3px 3px 0 {borderColor}; background:{design.bg}; --card-fg:{design.fg}; --card-dim:{design.dim};"
            >
              <CardPattern kind={design.pattern} color={design.patternColor} opacity={design.patternOpacity} />
              <div class="bank-figure-id">
                <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} size={18} />
                <div class="bank-figure-name">{b.bank.name}</div>
              </div>
              <!-- 3 rows: Start/Spent, Sent/Received, Fixed deposit/Balance --
                   Received and Fixed deposit used to live as bolt-ons/a
                   badge elsewhere (a "+X in" sub-line under Sent, a
                   "locked" badge next to the bank name) -- promoted to
                   their own stat slots here so every figure this card is
                   built to reconcile (Start - Sent + Received - Spent =
                   Balance, with Fixed deposit already baked into
                   Start/Balance same as Reserved -- see bankBreakdown's own
                   comment) is equally visible, not tucked into a corner.
                   Always shown (even at RM 0.00), same as Start/Spent/
                   Balance already are, so the
                   3-row shape stays predictable card to card. -->
              <div class="bank-figure-stats">
                <div class="bank-figure-stat">
                  <div class="k">Start</div>
                  <div class="v num">RM {fmt(b.startBalance)}</div>
                  {#if b.startIncoming > 0}<div class="v-sub num" style="color:var(--good);">+{fmt(b.startIncoming)}</div>{/if}
                </div>
                <div class="bank-figure-stat right">
                  <div class="k">Spent</div>
                  <div class="v num" style="color:var(--red);">RM {fmt(b.spending)}</div>
                  {#if b.reserved > 0}<div class="v-sub num" style="color:var(--gold);">+{fmt(b.reserved)} goals</div>{/if}
                </div>
                <div class="bank-figure-stat">
                  <div class="k">Sent</div>
                  <div class="v num" style="color:var(--red);">RM {fmt(b.transferOut)}</div>
                </div>
                <div class="bank-figure-stat right">
                  <div class="k">Received</div>
                  <div class="v num">RM {fmt(b.transferIn)}</div>
                </div>
                <div class="bank-figure-stat">
                  <div class="k">Fixed deposit</div>
                  <div class="v num" style="color:var(--gold);">RM {fmt(b.fixedDeposit)}</div>
                </div>
                <div class="bank-figure-stat right">
                  <div class="k">Balance</div>
                  <div class="v num">RM {fmt(b.endBalance)}</div>
                </div>
              </div>
            </div>
          {/each}
          </div>
        </div>
      {/if}
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
  .detail-hd {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--dim);
    padding: 8px 4px 2px;
  }
  /* Label-above-value stat pair, same pattern BankCard.svelte's own
     Income/Spending row already uses -- unlike an inline "Label RM X" run
     (.detail-figures' style), each stat gets its own column that can grow
     independently, so a 4-digit Start next to a 4-digit Spent never
     squeezes the row into wrapping the way one shared line did.

     One card fills the section's full width at a time (scroll-snap-align
     below) instead of several narrow ones side by side -- swiping pages to
     the next bank, same "one at a time" feel as Home's own BankCarousel,
     rather than a row of small cards competing for space. Height still
     stays constant regardless of bank count, same reason as before; no
     touch-action/overscroll-behavior override, same reason as chip-scroll
     elsewhere in this app (both were tried on other rows and each broke
     scrolling worse than the problem they were meant to fix). */
  .bank-figure-scroll {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 2px 2px 6px;
    scroll-snap-type: x mandatory;
  }
  .bank-figure-scroll::-webkit-scrollbar { display: none; }
  /* Miniature echo of BankCard.svelte's own face -- same design/pattern/
     border-color language (getCardDesign, cardBorderColor, CardPattern) so
     a bank reads as the same object here as it does on its own card, just
     scaled down: no traffic lights, flip, or eye-toggle, since there's no
     room (or need) for those at this size. */
  .bank-figure-card {
    flex-shrink: 0;
    width: 100%;
    min-height: 130px;
    box-sizing: border-box;
    scroll-snap-align: start;
    padding: 16px 16px 14px;
    border: 1.5px solid var(--stroke-2);
    border-radius: 16px;
    position: relative;
    z-index: 0;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    /* Content flows top-to-bottom at its own natural size, not spread to
       fill the card -- optional per-bank content (the reserved sub-line,
       Start's income bolt-on) makes card height vary bank to bank, and
       space-between would stretch that gap unevenly instead of just
       stacking content from the top. */
    justify-content: flex-start;
  }
  .bank-figure-id {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
    min-width: 0;
  }
  .bank-figure-name {
    font-weight: 700;
    font-size: 12px;
    color: var(--card-fg, var(--hi));
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* 3x2 grid (Start/Spent, Sent/Received, Fixed deposit/Balance) instead of
     a single space-between row -- reads left-to-right, top-to-bottom as
     Start - Sent + Received - Spent = Balance (Fixed deposit sits alongside
     Balance since it's a fixed, single fact about the bank itself, not
     this cycle's activity, same as Reserved's own bolt-on under Spent),
     the exact check this card exists to make possible without opening
     anything else. */
  .bank-figure-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px 8px;
  }
  .bank-figure-stat {
    min-width: 0;
    overflow: hidden;
  }
  .bank-figure-stat.right {
    text-align: right;
  }
  .bank-figure-stat .k {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--card-dim, var(--dim));
  }
  .bank-figure-stat .v {
    font-size: 12px;
    font-weight: 700;
    margin-top: 2px;
    color: var(--card-fg, var(--hi));
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Additional income/transfer-in stays right on Start, where the money
     actually landed -- only fixed deposit/goal-reserved (which apply to
     BOTH Start and Balance identically) moved to the shared footer below. */
  .bank-figure-stat .v-sub {
    font-size: 10px;
    font-weight: 700;
    margin-top: 1px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Same divider .detail-figures uses above it -- separates the per-bank
     breakdown from the category/extra list that follows. */
  .bank-figures-group {
    padding-bottom: 6px;
    border-bottom: 1px solid var(--stroke);
    margin-bottom: 4px;
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
