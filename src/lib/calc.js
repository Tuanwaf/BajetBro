export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// How much each category currently contributes to (or draws from) the
// shared Buffer pool:
// - Locked categories use their frozen `lockedLeftover` snapshot (planned -
//   actual at the moment they were locked) -- that amount was a deliberate,
//   one-time "I'm done spending here" declaration.
// - Unlocked categories that are OVER their planned amount draw from the
//   pool automatically and continuously -- an overspend has *already*
//   happened, there's no ambiguity to wait on, so Buffer reflects it in
//   real time (e.g. voluntarily sending extra money to Saving beyond its
//   plan immediately shrinks Buffer by that same amount).
// - Unlocked categories that are UNDER their planned amount do NOT credit
//   Buffer yet -- being under budget so far this month doesn't mean the
//   category is finished (you might just not have bought groceries yet);
//   that only happens once the category is explicitly locked.
export function computeLiveAdjustment(month) {
  return round2(
    (month.categories || []).reduce((s, c) => {
      if (c.locked) return s + (c.lockedLeftover || 0);
      // `|| 0` guards against a category with no `actual` at all (e.g. a
      // freshly-added one) -- without it, `c.planned - c.actual` is NaN,
      // and since `s` itself becomes NaN the instant that happens, every
      // category AFTER it in this reduce gets silently poisoned too, not
      // just the one missing `actual`.
      return s + Math.min(0, c.planned - (c.actual || 0));
    }, 0)
  );
}

// Buffer's planned figure is based on the comprehensive Income (rolled-
// forward balance + salary + bonus + additional income), NOT just this
// month's Salary -- otherwise Buffer understates what's actually available
// and never matches the Income figure shown elsewhere on Home.
//
// KEPT ONLY for backfillSingleBank's one-time bootstrap (see
// bankPreviewStore.js) -- there's no bank list yet at that exact moment, so
// this old single-pool figure is the only thing available to seed the
// first bank's balance from. Every LIVE call site (Home, Settings,
// EndMonthSheet) uses computeBufferPlannedLive below instead -- see its
// comment for why: this version has no idea a bank even exists, so any
// money moved by a Transfer or a goal contribution/withdrawal (see
// bankPreviewStore.js) is invisible to it, and it silently drifts from
// reality forever after.
export function computeBufferPlanned(month) {
  const coreSum = (month.categories || []).reduce((s, c) => s + c.planned, 0);
  const totalBalance = computeTotalBalance(month);
  const base = totalBalance != null ? totalBalance : (month.income || 0) + (month.bonus || 0) + (month.additionalIncome || 0);
  return round2(Math.max(0, base - coreSum) + computeLiveAdjustment(month));
}

// Total "Commitments" figure shown on Home: categories that are either
// locked or currently over their planned amount count their actual spend
// instead (that's what's really been drawn from the pool), everyone else
// counts their planned figure, plus Buffer itself. This always nets back to
// exactly the Income figure, regardless of locking or overspending.
//
// See computeBufferPlanned's comment -- kept only for the same bootstrap
// reason; live call sites use computePlannedTotalLive.
export function computePlannedTotal(month) {
  const categories = month.categories || [];
  const coreTotal = categories.reduce((s, c) => s + (c.locked || c.actual > c.planned ? c.actual || 0 : c.planned), 0);
  return round2(coreTotal + computeBufferPlanned(month));
}

export function computeBufferActual(month) {
  return round2((month.extras || []).reduce((s, e) => s + (e.actual || 0), 0));
}

// The REAL, live "how much do I actually have" figure -- summed straight
// from every bank's free-to-spend money (balance minus whatever's reserved
// for open goals or locked in a fixed deposit -- the same "free" number
// each BankCard already shows). Takes the *enriched* bank list from
// bankPreviewStore.js's `banks` derived store (each entry already carries
// `.reserved`), not raw db.banks.
//
// This is what closes the gap between Buffer/Commitments and reality:
// unlike the old single-pool figures above, a Transfer, a goal
// contribution/withdrawal, or anything else that moves money between banks
// without ever touching a category shows up here immediately, because it's
// reading the bank balances those operations actually changed -- not a
// separate `month.startingBalance` chain that never heard about them.
export function computeBankFreeTotal(banks) {
  return round2((banks || []).reduce((s, b) => s + Math.max(0, (b.balance || 0) - (b.reserved || 0) - (b.fixedDeposit || 0)), 0));
}

// Live version of computeBufferPlanned, anchored to computeBankFreeTotal
// instead of month.startingBalance. `liveTotal` already has every real
// transaction's effect baked in -- categories, buffer, transfers, goals,
// all of it -- so the only thing left to subtract is money not yet spent
// but still owed to an open (non-locked) category. A locked category is
// done: whatever it under/overspent already shows up inside `liveTotal`
// directly (the bank it was paid from already moved), so unlike
// computeLiveAdjustment there's no separate leftover/overspend bookkeeping
// needed here at all.
export function computeBufferPlannedLive(month, liveTotal) {
  const owed = (month.categories || []).reduce((s, c) => (c.locked ? s : s + Math.max(0, c.planned - (c.actual || 0))), 0);
  return round2(liveTotal - owed + computeBufferActual(month));
}

// Live version of computePlannedTotal, using computeBufferPlannedLive.
export function computePlannedTotalLive(month, liveTotal) {
  const categories = month.categories || [];
  const coreTotal = categories.reduce((s, c) => s + (c.locked || c.actual > c.planned ? c.actual || 0 : c.planned), 0);
  return round2(coreTotal + computeBufferPlannedLive(month, liveTotal));
}

export function computeCoreActual(month) {
  return round2((month.categories || []).reduce((s, c) => s + (c.actual || 0), 0));
}

// Earliest real boundary of a cycle -- month.startedAt when present,
// otherwise the earliest date among its own dated entries (a cycle can
// start before the 1st of a calendar month, so this predates that field).
// Shared by anything that needs to decide whether a goal allocation/spend
// (dated, but not itself nested inside a month the way categories/extras
// are) belongs to this cycle -- originally Home.svelte's own local
// `cycleStart`, moved here once computeGoalGivenTotal below needed the same
// logic too.
export function cycleStartOf(month) {
  if (!month) return null;
  if (month.startedAt) return month.startedAt;
  const dates = [];
  for (const cat of month.categories || []) for (const tx of cat.transactions || []) if (tx.date) dates.push(tx.date);
  for (const e of month.extras || []) if (e.date) dates.push(e.date);
  for (const e of month.additionalIncomeLog || []) if (e.date) dates.push(e.date);
  for (const t of month.transfers || []) if (t.date) dates.push(t.date);
  for (const r of month.reimbursements || []) if (r.date) dates.push(r.date);
  return dates.length ? dates.reduce((min, d) => (d < min ? d : min)) : null;
}

// Whether one goal allocation/spend belongs to THIS month's cycle. Never
// trust a bare calendar-month slice of its date -- a cycle can start before
// the 1st (see cycleStartOf above), so an entry dated e.g. 31 July can
// genuinely belong to the August cycle. cycleMonth (stamped at write time,
// see Goals.svelte) is authoritative when present; only entries logged
// before that field existed fall back to comparing against cycleStartOf.
export function inCycle(month, date, entryCycleMonth) {
  if (entryCycleMonth) return entryCycleMonth === month.key;
  if (!date) return false;
  const start = cycleStartOf(month);
  if (start) return date >= start;
  return date.slice(0, 7) === month.key;
}

// Real money given away to (or spent out of) a goal THIS cycle -- a
// contribution that STAYS reserved (whichever bank it sits in) isn't
// spending at all, it's still yours, just earmarked; but one given away for
// good, or actually spent out of an already-reserved balance, permanently
// left a real bank exactly like a category/buffer expense would.
// computeCoreActual/computeBufferActual have no idea this ever happens --
// goals are a separate top-level table, never nested inside `month` -- so
// this is the piece that was missing from Monthly Log/End Month's own
// "Spent" figure, even though a bank's own per-bank Spending stat
// (computeBankActivity) already counted it correctly. A `starting`
// allocation is what a goal already had before it was ever tracked here,
// not something that happened this cycle, so it's excluded the same way
// Home's own goalActivity excludes it.
export function computeGoalGivenTotal(month, goals) {
  if (!month) return 0;
  let total = 0;
  for (const g of goals || []) {
    for (const a of g.allocations || []) {
      if (a.starting) continue;
      if (allocIsReserved(g, a)) continue;
      if (!inCycle(month, a.date, a.cycleMonth)) continue;
      total += a.amount || 0;
    }
    for (const s of g.spends || []) {
      if (!inCycle(month, s.date, s.cycleMonth)) continue;
      total += spendRM(g, s);
    }
  }
  return round2(total);
}

// Live total for the current/open month -- computed from line items, not the
// frozen `recordedTotal` (which is only authoritative for closed months).
// `goals` is optional (defaults to none) so every existing caller that has
// no goal list handy keeps its old category+buffer-only behavior -- pass it
// wherever it's available to fold in money given away to a goal this cycle
// too (see computeGoalGivenTotal above).
export function computeSpentTotal(month, goals) {
  return round2(computeCoreActual(month) + computeBufferActual(month) + computeGoalGivenTotal(month, goals));
}

// Bootstrap-only fallback: this month's own income-minus-spend, for the rare
// case a month has no Total balance yet (nothing to roll forward from).
export function computeRemaining(month) {
  const income = (month.income || 0) + (month.bonus || 0) + (month.additionalIncome || 0);
  return round2(income - computeSpentTotal(month));
}

// The comprehensive "Income" figure shown on Home: the rolled-forward
// balance plus any bonus (added at cycle start) and additional income
// (added anytime mid-cycle via Settings). `month.startingBalance` already
// has this month's own base Salary folded into it (it's a running
// cumulative total, not "leftover before salary arrived") -- bonus and
// additional income are the only pieces not yet reflected in it.
export function computeTotalBalance(month) {
  if (month.startingBalance == null) return null;
  return round2(month.startingBalance + (month.bonus || 0) + (month.additionalIncome || 0));
}

// Reimbursements ("paid back to me") credited to THIS month -- money others
// owed you that arrived now (e.g. a friend settling a bill from a past month).
// Kept entirely separate from Income/Salary; it just adds to what you have.
export function computeReimbursedTotal(month) {
  return round2((month.reimbursements || []).reduce((s, r) => s + (r.amount || 0), 0));
}

// True cash-on-hand and the figure that rolls forward into next month's
// Income balance. Reimbursements received this month add to it.
//
// KEPT ONLY for backfillSingleBank's one-time bootstrap (see
// computeBufferPlanned's comment above -- same reasoning). Live call sites
// use computeBankFreeTotal(banks) instead.
export function computeTotalRemaining(month) {
  const reimbursed = computeReimbursedTotal(month);
  const totalBalance = computeTotalBalance(month);
  if (totalBalance != null) {
    return round2(totalBalance + reimbursed - computeSpentTotal(month));
  }
  return round2(computeRemaining(month) + reimbursed);
}

export function computePotRemain(pot) {
  return round2(pot.initial - pot.used - pot.send);
}

export function computeOpenPots(pots) {
  return pots.filter((p) => computePotRemain(p) > 0.005);
}

export function computeSettledPots(pots) {
  return pots.filter((p) => computePotRemain(p) <= 0.005);
}

export function computePersonalSavings(pots) {
  return round2(pots.reduce((s, p) => s + computePotRemain(p), 0));
}

export function computeHutangLedgerRemain(ledger, pots) {
  const totalSend = pots.reduce((s, p) => s + p.send, 0);
  return round2(ledger.initial - totalSend);
}

export function computeHutangTotalSend(pots) {
  return round2(pots.reduce((s, p) => s + p.send, 0));
}

export function computeTabungHajiTotal(tabungHaji, pots, dividends) {
  const dividendsSum = (dividends || []).reduce((s, d) => s + d.amount, 0);
  return round2(tabungHaji.fixedDeposit + computePersonalSavings(pots) + dividendsSum);
}

export function computeDividendsTotal(dividends) {
  return round2((dividends || []).reduce((s, d) => s + d.amount, 0));
}

// ------------------------------------------------------------------ Goals ----
// A goal's ledgers are derived, never stored as running totals, so edits and
// deletes to individual entries always reconcile.

// Money put into a goal so far, in total -- this is what the progress bar and
// "reached" check care about, so it counts given-away amounts too (giving
// money away still counts as progress toward the goal, it just isn't
// sitting anywhere spendable afterward).
export function goalAllocated(g) {
  return round2((g.allocations || []).reduce((s, a) => s + (a.amount || 0), 0));
}

// Whether one allocation's money is still sitting somewhere spendable.
// heldInBankId is the source of truth once it's present (null = given away
// for good, a bank id = reserved there). Allocations from before this field
// existed never set it at all -- those fall back to the goal's old `type`
// (every pre-redesign "giving" allocation left for good; every "savings"
// one was reserved), so old data keeps behaving exactly as it always did.
//
// `fromBankId` is the tell for telling that legacy case apart from a
// SECOND, buggy way an allocation can end up with no `heldInBankId` key:
// AddExpenseSheet's "Add to a goal" used to write `heldInBankId ?? undefined`
// for a "given away" contribution, which silently turns the real `null`
// into a dropped key once the object round-trips through JSON (export/
// import, or just Dexie's own clone). Genuinely old, pre-heldInBankId data
// never has `fromBankId` either (it predates per-bank tagging entirely) --
// so an allocation with `fromBankId` set but no `heldInBankId` key is always
// this bug, never legacy data, and means "given away" (the fix now stores
// the literal null going forward; this covers whatever already got saved
// with the key missing before that fix).
export function allocIsReserved(g, a) {
  if ('heldInBankId' in a) return a.heldInBankId != null;
  if (a.fromBankId) return false;
  return g.type !== 'giving';
}

// RM value of one spend: convert at the goal's rate only when it was logged in
// the goal's own foreign currency; everything else is already RM.
export function spendRM(g, s) {
  return round2(g.currency && s.ccy === g.currency ? s.amount * (g.rate || 1) : s.amount);
}

// Total spent out of a goal (itemized), in RM.
export function goalSpent(g) {
  return round2((g.spends || []).reduce((s, x) => s + spendRM(g, x), 0));
}

// Money still sitting in the goal, reserved but not spent -- excludes
// anything already given away for good, since that's gone regardless of
// whether the goal's target has been reached. This is the only figure
// "Spend on a goal" can draw against.
export function goalReserveLeft(g) {
  const reserved = round2((g.allocations || []).reduce((s, a) => s + (allocIsReserved(g, a) ? a.amount || 0 : 0), 0));
  return round2(reserved - goalSpent(g));
}

// Per-bank breakdown of a goal's reserve -- spending on (or taking money out
// of) a goal has to come from wherever that reserve actually sits, not an
// arbitrary bank. Picking the wrong one would debit a bank that never
// actually held the money, while the goal's own numbers looked unchanged
// either way (goalReserveLeft doesn't care which bank absorbs a spend).
// Allocations from before bank-tagging existed have no heldInBankId to
// attribute to a bank, so they're simply left out here (goalReserveLeft
// still counts them in the total -- callers that can't fully cover that
// total from this breakdown should fall back to an unrestricted picker).
export function goalReserveByBank(g) {
  const map = new Map();
  const add = (bankId, amount) => {
    if (!bankId) return;
    map.set(bankId, round2((map.get(bankId) || 0) + amount));
  };
  for (const a of g.allocations || []) {
    if (!allocIsReserved(g, a)) continue;
    add(a.heldInBankId, a.amount || 0);
  }
  for (const s of g.spends || []) {
    add(s.bankId, -spendRM(g, s));
  }
  return [...map.entries()]
    .map(([bankId, amount]) => ({ bankId, amount: round2(amount) }))
    .filter((x) => x.amount > 0.005);
}

export function goalReached(g) {
  return goalAllocated(g) >= (g.target || 0);
}

export function computeTotalSaved(pots) {
  return round2((pots || []).reduce((s, p) => s + (p.initial || 0), 0));
}

// Reserve still held inside OPEN savings goals -- physically still in Tabung
// Haji, just earmarked, so it counts toward TH but not the free pool.
export function computeOpenSavingsReserve(goals) {
  return round2(
    (goals || [])
      .filter((g) => g.type === 'savings' && !g.closed)
      .reduce((s, g) => s + Math.max(0, goalReserveLeft(g)), 0)
  );
}

// The shared "Ready to allocate" pool: everything you've saved (pot inflows +
// dividends) minus what's currently tied up or already gone.
//   pool = totalSaved + dividends
//          - reserve still held in open savings goals
//          - everything given to giving goals (that money left)
//          - everything spent out of savings goals (left)
//          - personal spends from savings (left)
export function computeReadyToAllocate(pots, goals, dividends, savingsSpends) {
  const totalSaved = computeTotalSaved(pots);
  const totalDiv = computeDividendsTotal(dividends);
  const openReserve = computeOpenSavingsReserve(goals);
  const given = (goals || [])
    .filter((g) => g.type === 'giving')
    .reduce((s, g) => s + goalAllocated(g), 0);
  const savingsSpent = (goals || [])
    .filter((g) => g.type === 'savings')
    .reduce((s, g) => s + goalSpent(g), 0);
  const personalSpent = (savingsSpends || []).reduce((s, x) => s + (x.amount || 0), 0);
  return round2(totalSaved + totalDiv - openReserve - given - savingsSpent - personalSpent);
}

export function computePersonalSpentTotal(savingsSpends) {
  return round2((savingsSpends || []).reduce((s, x) => s + (x.amount || 0), 0));
}

// Tabung Haji total: fixed deposit (locked) + the liquid savings still in TH,
// which is the free pool plus reserve held in open savings goals. Dividends
// are already folded into the pool, so they're counted exactly once.
export function computeTabungHajiTotal2(tabungHaji, pots, goals, dividends, savingsSpends) {
  const fd = tabungHaji?.fixedDeposit || 0;
  return round2(
    fd + computeReadyToAllocate(pots, goals, dividends, savingsSpends) + computeOpenSavingsReserve(goals)
  );
}
