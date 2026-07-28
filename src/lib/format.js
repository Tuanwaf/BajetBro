export function formatMoney(n) {
  const v = Number(n) || 0;
  return 'RM' + v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
