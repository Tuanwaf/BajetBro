export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// How much each category currently contributes to (or draws from) the
// shared Ad-hoc pool:
// - Locked categories use their frozen `lockedLeftover` snapshot (planned -
//   actual at the moment they were locked) -- that amount was a deliberate,
//   one-time "I'm done spending here" declaration.
// - Unlocked categories that are OVER their planned amount draw from the
//   pool automatically and continuously -- an overspend has *already*
//   happened, there's no ambiguity to wait on, so Ad-hoc reflects it in
//   real time (e.g. voluntarily sending extra money to Saving beyond its
//   plan immediately shrinks Ad-hoc by that same amount).
// - Unlocked categories that are UNDER their planned amount do NOT credit
//   Ad-hoc yet -- being under budget so far this month doesn't mean the
//   category is finished (you might just not have bought groceries yet);
//   that only happens once the category is explicitly locked.
export function computeLiveAdjustment(month) {
  return round2(
    (month.categories || []).reduce((s, c) => {
      if (c.locked) return s + (c.lockedLeftover || 0);
      return s + Math.min(0, c.planned - c.actual);
    }, 0)
  );
}

// Ad-hoc's planned figure is based on the comprehensive Income (rolled-
// forward balance + salary + bonus + additional income), NOT just this
// month's Salary -- otherwise Ad-hoc understates what's actually available
// and never matches the Income figure shown elsewhere on Home.
export function computeAdhocPlanned(month) {
  const coreSum = (month.categories || []).reduce((s, c) => s + c.planned, 0);
  const totalBalance = computeTotalBalance(month);
  const base = totalBalance != null ? totalBalance : (month.income || 0) + (month.bonus || 0) + (month.additionalIncome || 0);
  return round2(Math.max(0, base - coreSum) + computeLiveAdjustment(month));
}

// Total "Commitments" figure shown on Home: categories that are either
// locked or currently over their planned amount count their actual spend
// instead (that's what's really been drawn from the pool), everyone else
// counts their planned figure, plus Ad-hoc itself. This always nets back to
// exactly the Income figure, regardless of locking or overspending.
export function computePlannedTotal(month) {
  const categories = month.categories || [];
  const coreTotal = categories.reduce((s, c) => s + (c.locked || c.actual > c.planned ? c.actual : c.planned), 0);
  return round2(coreTotal + computeAdhocPlanned(month));
}

export function computeAdhocActual(month) {
  return round2((month.extras || []).reduce((s, e) => s + e.actual, 0));
}

export function computeCoreActual(month) {
  return round2((month.categories || []).reduce((s, c) => s + c.actual, 0));
}

// Live total for the current/open month -- computed from line items, not the
// frozen `recordedTotal` (which is only authoritative for closed months).
export function computeSpentTotal(month) {
  return round2(computeCoreActual(month) + computeAdhocActual(month));
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

// Money put into a goal so far (reserved for savings goals, given for giving).
export function goalAllocated(g) {
  return round2((g.allocations || []).reduce((s, a) => s + (a.amount || 0), 0));
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

// For savings goals: money still sitting in the goal (reserved but not spent).
export function goalReserveLeft(g) {
  return round2(goalAllocated(g) - goalSpent(g));
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
