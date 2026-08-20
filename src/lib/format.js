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

// <input type="datetime-local">'s value/min/max all want the same
// timezone-less "YYYY-MM-DDTHH:mm" form, read in the browser's LOCAL time --
// not toISOString(), which is UTC and would silently shift the picker by
// whatever the device's UTC offset is.
export function toDatetimeLocalValue(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Which LOCAL calendar day a moment falls on, as "YYYY-MM-DD" -- for
// grouping dated entries (History's daily chart) by the day a person would
// actually call it, not `iso.slice(0, 10)`'s UTC day. Those disagree for
// several hours around local midnight in any timezone ahead of UTC (e.g. a
// 3am entry in Malaysia, UTC+8, is still the previous UTC day).
export function toLocalDateKey(date) {
  return toDatetimeLocalValue(date).slice(0, 10);
}

// The editable date/time range for an entry logged in `month`'s cycle --
// bounded below by month.startedAt (the cycle's real start, which can fall
// in the previous calendar month, e.g. "August" starting 31 July -- see
// EndMonthSheet's comment on confirmStartCycle) and above by `nextMonth`'s
// own startedAt if that cycle has already ended, or the current moment if
// it's still the open one (can't backdate past the cycle, or postdate past
// either "now" or into the next cycle). Either bound is '' (no restriction)
// when the month record predates `startedAt` existing.
export function cycleDatetimeBounds(month, nextMonth = null) {
  const min = month?.startedAt ? toDatetimeLocalValue(new Date(month.startedAt)) : '';
  const max = nextMonth?.startedAt ? toDatetimeLocalValue(new Date(nextMonth.startedAt)) : toDatetimeLocalValue(new Date());
  return { min, max };
}
