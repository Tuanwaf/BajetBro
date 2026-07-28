function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeAdhocPlanned(month, template) {
  const coreSum = template.categories.reduce((s, c) => s + c.planned, 0);
  return round2(Math.max(0, month.income - coreSum) + (month.bonus || 0));
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

export function computeRemaining(month) {
  const income = (month.income || 0) + (month.bonus || 0);
  return round2(income - computeSpentTotal(month));
}

export function computeRollsToNext(month) {
  if (month.startingBalance == null) return null;
  return round2(month.startingBalance + computeRemaining(month));
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
