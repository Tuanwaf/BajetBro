export function fmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatMoney(n) {
  return 'RM ' + fmt(n);
}

export function formatDate(iso) {
  if (!iso) return 'No date';
  const d = new Date(iso);
  return isNaN(d) ? 'No date' : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d) ? '' : d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' });
}
