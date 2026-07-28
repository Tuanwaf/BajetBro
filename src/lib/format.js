export function fmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMoney(n) {
  return 'RM ' + fmt(n);
}
