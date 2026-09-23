import db from './db.js';

// Past notes, grouped by where they were entered, so the Add entry sheet can
// offer "you usually write X here" chips. Derived entirely from notes already
// stored on existing entries (every month, open or closed, plus goal spends)
// -- nothing new is persisted, so it works on old data immediately and stays
// correct when an entry is edited or deleted elsewhere.
//
// Scope keys:
//   cat:<categoryKey>   fixed category expense (transactions[].note)
//   buffer              Buffer entries (extras[].note)
//   reimburse           "Paid back to me"
//   income              additional income log
//   transfer            bank-to-bank transfers
//   goal:<goalId>       spends out of a goal (spends[].label)
//   alloc:<goalId>      money added to a goal (allocations[].note)
export async function loadNoteHistory() {
  const [months, goals] = await Promise.all([db.months.toArray(), db.goals.toArray()]);
  // scope -> Map(lowercased note -> { text, count, last })
  const byScope = new Map();
  const add = (scope, note, date) => {
    const text = (note || '').trim();
    if (!text) return;
    let bucket = byScope.get(scope);
    if (!bucket) byScope.set(scope, (bucket = new Map()));
    const k = text.toLowerCase();
    const t = date ? Date.parse(date) || 0 : 0;
    const prev = bucket.get(k);
    if (!prev) bucket.set(k, { text, count: 1, last: t });
    else {
      prev.count++;
      // Keep whichever spelling/casing was used most recently.
      if (t >= prev.last) {
        prev.last = t;
        prev.text = text;
      }
    }
  };

  for (const m of months) {
    for (const c of m.categories || []) for (const tx of c.transactions || []) add(`cat:${c.key}`, tx.note, tx.date);
    for (const e of m.extras || []) add('buffer', e.note, e.date);
    for (const r of m.reimbursements || []) add('reimburse', r.note, r.date);
    for (const i of m.additionalIncomeLog || []) add('income', i.note, i.date);
    for (const t of m.transfers || []) add('transfer', t.note, t.date);
  }
  for (const g of goals) {
    for (const a of g.allocations || []) if (!a.starting) add(`alloc:${g.id}`, a.note, a.date);
    // 'Spend' is the placeholder saved when no note was typed -- not a real
    // note worth suggesting back.
    for (const s of g.spends || []) if (s.label !== 'Spend') add(`goal:${g.id}`, s.label, s.date);
  }

  const out = {};
  for (const [scope, bucket] of byScope) {
    out[scope] = [...bucket.values()].sort((a, b) => b.count - a.count || b.last - a.last);
  }
  return out;
}

// Ranked suggestions for one scope, narrowed by whatever's typed so far:
// notes starting with the typed text first, then ones merely containing it.
// An exact match to what's already typed is dropped -- nothing left to fill.
export function suggestNotes(history, scope, typed, limit = 8) {
  const list = (scope && history?.[scope]) || [];
  const q = typed.trim().toLowerCase();
  if (!q) return list.slice(0, limit).map((e) => e.text);
  const starts = [];
  const contains = [];
  for (const e of list) {
    const t = e.text.toLowerCase();
    if (t === q) continue;
    if (t.startsWith(q)) starts.push(e.text);
    else if (t.includes(q)) contains.push(e.text);
  }
  return [...starts, ...contains].slice(0, limit);
}
