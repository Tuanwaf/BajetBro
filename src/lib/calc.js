export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Locking a category freezes its actual spend and sends whatever's left of
// its original planned amount (planned - actual, captured once at lock time
// as `lockedLeftover`) over to Ad-hoc. The category's own `planned` label is
// left untouched -- it's just historical context once locked -- so this
// adjustment is added on top rather than changing the base subtraction,
// which keeps the total always netting back to income + bonus regardless of
// how many categories are locked.
export function computeLockedAdjustment(month) {
  return round2((month.categories || []).filter((c) => c.locked).reduce((s, c) => s + (c.lockedLeftover || 0), 0));
}

export function computeAdhocPlanned(month) {
  const coreSum = (month.categories || []).reduce((s, c) => s + c.planned, 0);
  return round2(Math.max(0, month.income - coreSum) + (month.bonus || 0) + computeLockedAdjustment(month));
}

// Total "Commitments" figure shown on Home: unlocked categories still count
// their planned amount, but locked ones count their frozen actual instead
// (their remaining budget already moved to Ad-hoc), plus Ad-hoc itself.
export function computePlannedTotal(month) {
  const categories = month.categories || [];
  const coreTotal = categories.reduce((s, c) => s + (c.locked ? c.actual : c.planned), 0);
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
// case a month has no Starting balance yet (nothing to roll forward from).
export function computeRemaining(month) {
  const income = (month.income || 0) + (month.bonus || 0);
  return round2(income - computeSpentTotal(month));
}

// True cash-on-hand and the figure that rolls forward into next month's
// Starting balance. IMPORTANT: `month.startingBalance` already has this
// month's own income folded into it (it's a running cumulative total, not
// "leftover before this month's income arrived") -- so this must NOT add
// month.income again on top, only any extra bonus/additional income, which
// genuinely isn't reflected in Starting yet.
export function computeTotalRemaining(month) {
  if (month.startingBalance != null) {
    return round2(month.startingBalance + (month.bonus || 0) - computeSpentTotal(month));
  }
  return computeRemaining(month);
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
