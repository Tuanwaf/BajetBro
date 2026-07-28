function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function computeAdhocPlanned(month, template) {
  const coreSum = template.categories.reduce((s, c) => s + c.planned, 0);
  return round2(month.income - coreSum + (month.bonus || 0));
}

export function computeAdhocActual(month) {
  return round2((month.extras || []).reduce((s, e) => s + e.actual, 0));
}

export function computeCoreActual(month) {
  return round2((month.categories || []).reduce((s, c) => s + c.actual, 0));
}

export function computePotRemain(pot) {
  return round2(pot.initial - pot.used - pot.send);
}

export function computeHutangLedgerRemain(ledger, pots) {
  const totalSend = pots.reduce((s, p) => s + p.send, 0);
  return round2(ledger.initial - totalSend);
}

export function computeTabungHajiTotal(tabungHaji, pots, dividends) {
  const openPotsRemain = pots.reduce((s, p) => {
    const remain = computePotRemain(p);
    return remain > 0 ? s + remain : s;
  }, 0);
  const dividendsSum = (dividends || []).reduce((s, d) => s + d.amount, 0);
  return round2(tabungHaji.fixedDeposit + openPotsRemain + dividendsSum);
}
