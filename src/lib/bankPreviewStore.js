// Bank list -- persisted to Dexie (db.banks, see db.js v4), not mock data
// anymore. Kept as its own module (rather than folded fully into
// stores.js) since Settings' "Manage banks" sheet, Home's carousel, and
// OnboardingFlow all need the same mutating functions, not just the live
// data.
//
// Transaction-level tagging (see feature/multi-bank): each category
// transaction/buffer extra/reimbursement can carry a `bankId`. `balance` is
// the one thing actually stored on a bank record -- a real running total,
// adjusted immediately via adjustBankBalance whenever a tagged entry is
// added/edited/deleted, so it rolls forward across months exactly like a
// real account would. `income`/`spending`/`transactions` are deliberately
// NOT stored -- they're THIS CYCLE's activity, so they're computed live
// from the current month's tagged entries instead (computeBankActivity).
// Storing a duplicate copy of those three would mean keeping them in sync
// by hand at every single edit/delete site across the app (CategoryDetail/
// BufferDetail/RemibursementsSheet); computing them from the one existing
// source of truth (the month itself) makes that whole class of desync bug
// impossible, and End Month resetting categories/extras/reimbursements to
// empty for the new month already makes each bank's activity reset for
// free, with no bank-specific reset code needed.
import { derived, writable, get } from 'svelte/store';
import db from './db.js';
import { banks as rawBanks, currentMonth, closedMonths, goals as goalsStore } from './stores.js';
import { GOAL_COLORS, BUFFER_COLOR } from './constants.js';
import { round2, spendRM, goalReserveByBank, computeTotalRemaining, inCycle } from './calc.js';

// True once a bank has appeared in ANY real transaction, in ANY month ever
// tracked (not just this cycle) -- Balance is only meant to be hand-typed
// while setting the bank up; once something's actually happened through
// it, editing Balance directly would silently create drift (a Balance jump
// with no dated entry behind it) instead of a real, dated transaction.
// BankFormFields uses this to lock the Balance field in edit mode.
export function bankHasHistory(bankId) {
  if (!bankId) return false;
  const months = [...(get(closedMonths) || []), get(currentMonth)].filter(Boolean);
  for (const month of months) {
    for (const cat of month.categories || []) {
      if ((cat.transactions || []).some((tx) => tx.bankId === bankId)) return true;
    }
    if ((month.extras || []).some((e) => e.bankId === bankId)) return true;
    if ((month.reimbursements || []).some((r) => r.bankId === bankId)) return true;
    if ((month.additionalIncomeLog || []).some((e) => e.bankId === bankId)) return true;
    if ((month.transfers || []).some((t) => t.fromBankId === bankId || t.toBankId === bankId)) return true;
  }
  for (const g of get(goalsStore) || []) {
    if ((g.allocations || []).some((a) => a.fromBankId === bankId || a.heldInBankId === bankId)) return true;
    if ((g.spends || []).some((s) => s.bankId === bankId)) return true;
  }
  return false;
}

// Folds a hand-typed Balance change straight into this cycle's baseline
// (month.startingBalance), NOT into Additional income -- this only ever
// runs for a bank with no history yet (see bankHasHistory), while you're
// still setting a starting number, not logging something that happened.
// It shouldn't leave a dated entry anywhere (no note, no bankId, nothing
// in BankTransactionsSheet) -- it's a correction to the starting point
// itself, same as if you'd typed the right number the first time. Feeds
// History's Monthly-log "Income" (startingBalance + bonus + additionalIncome)
// without ever looking like a transaction.
async function adjustCycleBaseline(delta) {
  if (!delta) return;
  const month = get(currentMonth);
  if (!month) return; // no cycle yet -- e.g. onboarding is creating the very first one itself
  await db.months.update(month.key, { startingBalance: round2((month.startingBalance || 0) + delta) });
}

// Scans one month for every entry tagged with this bank, in the exact
// {note, date, amount, income, color} shape BankCard/BankTransactionsSheet/
// Home's recent-list already render -- so plugging live data in here needed
// zero changes to any of those. Deliberately not scanning goal
// allocations/spends or savingsSpends -- those move money between an
// internal pool/goal, not a real bank transaction, and stay out of scope.
//
// Each entry also carries `source` -- a reference back to the exact object
// inside `month` it came from (not a copy), plus enough to locate its
// array, so moveTransactionBank() below can retag it in place. Reference
// identity works here because `tx`/`e`/`r` below ARE the live objects
// nested inside the very `month` argument passed in, not clones of them --
// same assumption CategoryDetailSheet's own edit/delete already relies on.
export function computeBankActivity(month, allGoals, bankId) {
  if (!month || !bankId) return { income: 0, spending: 0, transactions: [] };
  const entries = [];

  for (const cat of month.categories || []) {
    for (const tx of cat.transactions || []) {
      if (tx.bankId === bankId) {
        entries.push({ note: tx.note || cat.name, date: tx.date, amount: tx.amount, reimbursed: tx.reimbursed || 0, income: false, color: cat.color, source: { kind: 'category', catKey: cat.key, tx } });
      }
    }
  }
  for (const e of month.extras || []) {
    if (e.bankId === bankId) {
      const full = round2((e.actual || 0) + (e.reimbursed || 0));
      entries.push({ note: e.note || e.name, date: e.date, amount: full, reimbursed: e.reimbursed || 0, income: false, color: BUFFER_COLOR, source: { kind: 'buffer', extra: e } });
    }
  }
  for (const r of month.reimbursements || []) {
    if (r.bankId === bankId) {
      entries.push({ note: r.note || 'Paid back', date: r.date, amount: r.amount, income: true, color: 'var(--good)', source: { kind: 'reimbursement', entry: r } });
    }
  }
  // Additional income (freelance, gift, refund, etc.) -- unlike a
  // reimbursement, this counts toward Income/Buffer (see calc.js), not just
  // Remaining. It has no category of its own, so BankTransactionsSheet is
  // the only place it's ever shown at all (see updateTaggedEntry/
  // deleteTaggedEntry below, which every kind's edit/delete there uses).
  for (const e of month.additionalIncomeLog || []) {
    if (e.bankId === bankId) {
      entries.push({ note: e.note || 'Additional income', date: e.date, amount: e.amount, income: true, color: 'var(--good)', source: { kind: 'additionalIncome', entry: e } });
    }
  }
  // Salary (+ bonus) landing in the main bank at cycle start (see
  // EndMonthSheet's confirmStartCycle) is a REAL adjustBankBalance credit,
  // but until now had no dated entry anywhere to represent it -- it was
  // completely invisible to this whole reconstruction. That silently broke
  // bankNetMovement (see History.svelte) for every month BEFORE the one
  // that just started: walking backward from the bank's current real
  // balance to reconstruct an old month's Start/Balance sums every month's
  // net movement from that month through to today, and a real credit with
  // no entry to represent it just doesn't get subtracted back out, so the
  // instant a new cycle starts, every earlier closed month's reconstructed
  // Start/Balance for this bank jumps up by exactly the new cycle's salary
  // -- which is the exact bug this fixes. Not `neutral` -- salary landing
  // in a bank genuinely is that bank's income this cycle, same as
  // Additional income, so it correctly counts toward the Income stat too.
  if (month.salaryCredit && month.salaryCredit.bankId === bankId) {
    const sc = month.salaryCredit;
    entries.push({ note: 'Salary', date: sc.date, amount: sc.amount, income: true, color: 'var(--good)', source: { kind: 'salaryCredit' } });
  }
  // Transfers -- relocating your own money between two of your own banks,
  // neither side is real income or spending. Both stay `neutral: true`,
  // excluded from this bank's Income/Spending sums -- it's still your own
  // money just changing which account it sits in, not something you earned.
  // `income: true` stays on the receiving side (unlike the sending side's
  // `income: false`) purely as a direction tag: History's own per-bank
  // breakdown (bankBreakdown in History.svelte) filters on
  // `source.kind === 'transfer' && e.income` to show it as its own "+Y"
  // bolt-on line on Start, separate from the headline Income figure --
  // that filter, and bankNetMovement's real-balance-movement math (which
  // deliberately ignores `neutral`, see its own comment), both still work
  // unchanged; only the Income STAT itself (entries filtered by
  // `e.income && !e.neutral`) now correctly excludes it.
  for (const t of month.transfers || []) {
    if (t.fromBankId === bankId) {
      entries.push({ note: t.note || 'Transfer out', date: t.date, amount: t.amount, income: false, neutral: true, color: 'var(--dim)', source: { kind: 'transfer', transfer: t } });
    }
    if (t.toBankId === bankId) {
      entries.push({ note: t.note || 'Transfer in', date: t.date, amount: t.amount, income: true, neutral: true, color: 'var(--dim)', source: { kind: 'transfer', transfer: t } });
    }
  }
  // Goal allocations/spends -- see AddExpenseSheet's "addgoal" save branch
  // for the full model: an allocation given away (heldInBankId == null) is
  // real spending; one moved into a different bank is a relocation (neutral,
  // like a transfer, on BOTH sides); one that stays in the same bank never
  // touches a real balance at all, so it's intentionally not listed here --
  // see computeBankReserved below for that. Spends are always real spending,
  // wherever the reserve happened to be sitting, converted to RM since a
  // goal's own ledger can be in a foreign currency but a bank's can't.
  //
  // inCycle(month, ...) is required here -- goals live in their own
  // top-level table, never nested inside `month` the way categories/extras
  // are, so without scoping this to THIS cycle every allocation/spend ever
  // made would show up again in every later month's activity forever (a
  // real bug: a goal contribution made in August kept reappearing as an
  // August-dated "Given to X" entry in September's, October's, etc. own
  // bank activity, on top of whatever actually happened that cycle).
  for (const g of allGoals || []) {
    for (const a of g.allocations || []) {
      if (!inCycle(month, a.date, a.cycleMonth)) continue;
      if (a.fromBankId === bankId && a.heldInBankId == null) {
        entries.push({ note: a.note || `Given to ${g.label}`, date: a.date, amount: a.amount, income: false, color: g.color, source: { kind: 'goalAllocation', goalId: g.id, alloc: a } });
      } else if (a.fromBankId === bankId && a.heldInBankId && a.heldInBankId !== bankId) {
        entries.push({ note: `Reserved for ${g.label}`, date: a.date, amount: a.amount, income: false, neutral: true, color: g.color, source: { kind: 'goalAllocation', goalId: g.id, alloc: a } });
      } else if (a.heldInBankId === bankId && a.fromBankId !== bankId) {
        entries.push({ note: `Reserved for ${g.label}`, date: a.date, amount: a.amount, income: true, neutral: true, color: g.color, source: { kind: 'goalAllocation', goalId: g.id, alloc: a } });
      }
    }
    for (const s of g.spends || []) {
      if (!inCycle(month, s.date, s.cycleMonth)) continue;
      if (s.bankId === bankId) {
        entries.push({ note: s.label || `Spent · ${g.label}`, date: s.date, amount: spendRM(g, s), income: false, color: g.color, source: { kind: 'goalSpend', goalId: g.id, spend: s } });
      }
    }
  }

  entries.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  const income = round2(entries.filter((e) => e.income && !e.neutral).reduce((s, e) => s + e.amount, 0));
  // Net of whatever's been paid back -- entries keep their gross `amount`
  // for display/editing (BankTransactionsSheet's quick editor treats it as
  // the real gross figure), but the Spending stat itself should reflect
  // money you're actually still out, same as a category/buffer's own
  // `actual` already does.
  const spending = round2(entries.filter((e) => !e.income && !e.neutral).reduce((s, e) => s + (e.amount - (e.reimbursed || 0)), 0));
  return { income, spending, transactions: entries };
}

// All-time (not month-scoped -- a goal can take months to fund) amount
// currently sitting in this specific bank, earmarked for open goals.
// Closed goals release their reserve the moment they're closed (same
// precedent as the old computeOpenSavingsReserve) -- no separate "return
// the leftover" step needed.
export function computeBankReserved(allGoals, bankId) {
  return computeBankReservedAsOf(allGoals, bankId, null);
}

// Point-in-time version for History's Monthly Log -- computeBankReserved
// above always answers "how much is reserved RIGHT NOW," which is exactly
// what Home/BankCard/ManageBanksSheet want, but is wrong for a CLOSED (or
// even the current) row's own Start/Balance reconstruction: a goal
// allocation/spend made mid-cycle would otherwise look like it had already
// been reserved since before that cycle even started, understating that
// row's true starting free balance by however much got reserved partway
// through. `cutoffKey` (a month.key, e.g. '2026-08') restricts this to only
// allocations/spends dated on or before it -- `null` means no cutoff (same
// as the live, all-time answer above). Falls back to the entry's own
// `date` (sliced to YYYY-MM) for anything logged before `cycleMonth`
// existed. Goal-closed state has no historical timestamp of its own either
// (just a `closed` boolean, not "closed as of when") -- still read from its
// CURRENT value uniformly across every row, same simplifying tradeoff this
// whole reconstruction already makes elsewhere for figures with no
// per-month history (see bankBreakdown's own comment in History.svelte).
export function computeBankReservedAsOf(allGoals, bankId, cutoffKey) {
  const entryKey = (e) => e.cycleMonth || (e.date ? String(e.date).slice(0, 7) : null);
  const onOrBefore = (e) => {
    if (!cutoffKey) return true;
    const key = entryKey(e);
    return !key || key <= cutoffKey;
  };
  let total = 0;
  for (const g of allGoals || []) {
    if (g.closed) continue;
    let heldHere = 0;
    for (const a of g.allocations || []) {
      if (a.heldInBankId === bankId && onOrBefore(a)) heldHere = round2(heldHere + a.amount);
    }
    for (const s of g.spends || []) {
      if (s.bankId === bankId && onOrBefore(s)) heldHere = round2(heldHere - spendRM(g, s));
    }
    total = round2(total + Math.max(0, heldHere));
  }
  return total;
}

// An ordinary category/buffer expense has no idea a bank has money
// earmarked for a goal, so it can dip into that reserve without anyone
// noticing (see AddExpenseSheet's overspend warning, which decides whether
// to interrupt saving in the first place). This function is the other half:
// keeping the goal's own reserve/progress numbers honest about it, no matter
// how that expense's bank tag or amount later changes.
//
// Call AFTER the triggering entry's bank balance has already reached its
// final value for this edit (adjustBankBalance already applied) -- it reads
// the bank's CURRENT balance and compares it to the CURRENT total reserved
// there. `prevConsumption` is whatever this same entry stamped on itself
// last time (undefined/[] the first time, or on a never-tagged entry); it's
// always reversed first, so edits and deletes both "give back" exactly what
// they'd previously taken before re-deriving what (if anything) is owed now.
// Returns the fresh consumption list to stamp back onto the entry -- empty
// once there's nothing left to attribute (e.g. after a delete, or once the
// balance covers the reserve again).
export async function reconcileGoalReserve(bankId, prevConsumption) {
  if (prevConsumption?.length) {
    await db.transaction('rw', db.goals, async () => {
      for (const { goalId, allocId } of prevConsumption) {
        const g = await db.goals.get(goalId);
        if (!g) continue;
        await db.goals.update(goalId, { allocations: (g.allocations || []).filter((a) => a.id !== allocId) });
      }
    });
  }
  if (!bankId) return [];
  const bank = await db.banks.get(bankId);
  if (!bank) return [];
  const goalsNow = await db.goals.toArray();
  const reserved = computeBankReserved(goalsNow, bankId);
  if (reserved <= 0.005 || bank.balance >= reserved - 0.005) return [];
  let remaining = round2(Math.min(reserved, reserved - bank.balance));
  const consumed = [];
  await db.transaction('rw', db.goals, async () => {
    for (const g of goalsNow) {
      if (remaining <= 0.005) break;
      if (g.closed) continue;
      const held = goalReserveByBank(g).find((x) => x.bankId === bankId)?.amount ?? 0;
      if (held <= 0.005) continue;
      const take = round2(Math.min(remaining, held));
      const allocId = 'rc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      const allocations = [...(g.allocations || []), { id: allocId, date: new Date().toISOString(), cycleMonth: get(currentMonth)?.key, amount: -take, heldInBankId: bankId, spentElsewhere: true }];
      await db.goals.update(g.id, { allocations });
      consumed.push({ goalId: g.id, allocId, amount: take });
      remaining = round2(remaining - take);
    }
  });
  return consumed;
}

// Re-tags one or more bank-tracked entries (wherever they actually live --
// category transactions, buffer extras, reimbursements, additional income,
// any mix at once) to a different bank, moving each one's balance impact
// off its old bank and onto the new one. Nothing about the category/
// commitments side changes -- which bank paid for something is orthogonal
// to which category it's budgeted under, so this only ever touches
// `bankId` plus every affected bank's balance.
//
// Threads categories/extras/reimbursements/additionalIncomeLog through a
// LOCAL variable across the loop (not re-reading month.* each iteration) --
// selecting several entries and moving them together means every one of
// them has to land in the SAME db.months.update call. Calling this once per
// entry against the same (by-then-stale) `month` snapshot would make each
// call overwrite the previous one's edit, since every call starts from
// month's original arrays rather than the prior call's result.
export async function moveTransactionsBank(month, sources, newBankId) {
  let categories = month.categories;
  let extras = month.extras;
  let reimbursements = month.reimbursements;
  let additionalIncomeLog = month.additionalIncomeLog;
  const balanceDeltas = {}; // bankId -> net change to apply once, at the end

  for (const source of sources) {
    if (source.kind === 'category') {
      const oldBankId = source.tx.bankId;
      if (oldBankId === newBankId) continue;
      categories = categories.map((c) =>
        c.key === source.catKey
          ? { ...c, transactions: (c.transactions || []).map((t) => (t === source.tx ? { ...t, bankId: newBankId || undefined } : t)) }
          : c
      );
      if (oldBankId) balanceDeltas[oldBankId] = round2((balanceDeltas[oldBankId] || 0) + source.tx.amount);
      if (newBankId) balanceDeltas[newBankId] = round2((balanceDeltas[newBankId] || 0) - source.tx.amount);
    } else if (source.kind === 'buffer') {
      const oldBankId = source.extra.bankId;
      if (oldBankId === newBankId) continue;
      const full = round2((source.extra.actual || 0) + (source.extra.reimbursed || 0));
      extras = extras.map((e) => (e === source.extra ? { ...e, bankId: newBankId || undefined } : e));
      if (oldBankId) balanceDeltas[oldBankId] = round2((balanceDeltas[oldBankId] || 0) + full);
      if (newBankId) balanceDeltas[newBankId] = round2((balanceDeltas[newBankId] || 0) - full);
    } else if (source.kind === 'reimbursement') {
      const oldBankId = source.entry.bankId;
      if (oldBankId === newBankId) continue;
      reimbursements = reimbursements.map((r) => (r === source.entry ? { ...r, bankId: newBankId || undefined } : r));
      if (oldBankId) balanceDeltas[oldBankId] = round2((balanceDeltas[oldBankId] || 0) - source.entry.amount);
      if (newBankId) balanceDeltas[newBankId] = round2((balanceDeltas[newBankId] || 0) + source.entry.amount);
    } else if (source.kind === 'additionalIncome') {
      const oldBankId = source.entry.bankId;
      if (oldBankId === newBankId) continue;
      additionalIncomeLog = additionalIncomeLog.map((e) => (e === source.entry ? { ...e, bankId: newBankId || undefined } : e));
      if (oldBankId) balanceDeltas[oldBankId] = round2((balanceDeltas[oldBankId] || 0) - source.entry.amount);
      if (newBankId) balanceDeltas[newBankId] = round2((balanceDeltas[newBankId] || 0) + source.entry.amount);
    }
    // transfer/goalAllocation/goalSpend entries aren't offered as selectable
    // in Move mode (BankTransactionsSheet gates them out) -- they're edited
    // from their own dedicated UI instead, so there's nothing to do here.
  }

  await db.transaction('rw', db.months, db.banks, async () => {
    await db.months.update(month.key, { categories, extras, reimbursements, additionalIncomeLog });
    for (const [bankId, delta] of Object.entries(balanceDeltas)) {
      await adjustBankBalance(bankId, delta);
    }
  });
}

// Adjusts this month's Saving pot -- the same bookkeeping CategoryDetailSheet
// does inline, extracted here so updateTaggedEntry/deleteTaggedEntry below
// can keep that in sync too when they touch the Saving category specifically.
async function adjustSavingPot(monthKey, delta) {
  if (!delta) return;
  const pot = await db.hutangPots.get(monthKey);
  if (pot) {
    const ni = round2(pot.initial + delta);
    if (ni > 0.005) await db.hutangPots.update(monthKey, { initial: ni });
    else await db.hutangPots.delete(monthKey);
  } else if (delta > 0) {
    await db.hutangPots.put({ month: monthKey, initial: round2(delta) });
  }
}

// BankTransactionsSheet's own quick editor for ANY bank-tracked entry --
// amount + note + date only, no category reassignment and no touching a category/
// buffer entry's own separate `reimbursed` split (CategoryDetailSheet/
// BufferDetailSheet remain where THOSE richer edits happen; this is a
// lighter "fix a typo'd amount" shortcut available right from the bank's
// own transaction list, since that's the only place additionalIncome is
// ever shown at all).
//
// Category actual/Saving-pot bookkeeping deliberately mirrors
// CategoryDetailSheet.txNet(): a category tx's `actual` tracks its NET
// (amount minus that tx's own `reimbursed` split), while its bank balance
// impact is always the GROSS `amount` -- reimbursement is a separate real
// cash event this editor doesn't touch, so holding it constant means the
// net delta and the gross delta are identical here regardless.
export async function updateTaggedEntry(month, source, { amount, note, date }) {
  const cleanNote = note || undefined;
  await db.transaction('rw', db.months, db.banks, db.hutangPots, db.goals, async () => {
    if (source.kind === 'category') {
      const tx = source.tx;
      const delta = round2(amount - tx.amount);
      const updatedTx = { ...tx, amount, note: cleanNote, date };
      let categories = month.categories.map((c) =>
        c.key === source.catKey
          ? { ...c, actual: round2(c.actual + delta), transactions: (c.transactions || []).map((t) => (t === tx ? updatedTx : t)) }
          : c
      );
      await db.months.update(month.key, { categories });
      if (source.catKey === 'saving') await adjustSavingPot(month.key, delta);
      if (tx.bankId && delta) await adjustBankBalance(tx.bankId, -delta);
      // Whatever this entry previously ate into a goal's reserve has to be
      // re-derived against its new amount -- otherwise editing it down (or
      // up) leaves the goal's reserve stuck at whatever the OLD amount had
      // consumed, out of sync with reality.
      if (tx.bankId) {
        const consumption = await reconcileGoalReserve(tx.bankId, tx.reserveConsumption);
        if (consumption.length || tx.reserveConsumption?.length) {
          categories = categories.map((c) =>
            c.key === source.catKey
              ? { ...c, transactions: c.transactions.map((t) => (t === updatedTx ? { ...t, reserveConsumption: consumption.length ? consumption : undefined } : t)) }
              : c
          );
          await db.months.update(month.key, { categories });
        }
      }
    } else if (source.kind === 'buffer') {
      const extra = source.extra;
      const oldFull = round2((extra.actual || 0) + (extra.reimbursed || 0));
      const delta = round2(amount - oldFull);
      const updatedExtra = { ...extra, actual: round2(amount - (extra.reimbursed || 0)), note: cleanNote, date };
      let extras = month.extras.map((e) => (e === extra ? updatedExtra : e));
      await db.months.update(month.key, { extras });
      if (extra.bankId && delta) await adjustBankBalance(extra.bankId, -delta);
      if (extra.bankId) {
        const consumption = await reconcileGoalReserve(extra.bankId, extra.reserveConsumption);
        if (consumption.length || extra.reserveConsumption?.length) {
          extras = extras.map((e) => (e === updatedExtra ? { ...e, reserveConsumption: consumption.length ? consumption : undefined } : e));
          await db.months.update(month.key, { extras });
        }
      }
    } else if (source.kind === 'reimbursement') {
      const entry = source.entry;
      const delta = round2(amount - entry.amount);
      const reimbursements = month.reimbursements.map((r) => (r === entry ? { ...r, amount, note: cleanNote, date } : r));
      await db.months.update(month.key, { reimbursements });
      if (entry.bankId && delta) await adjustBankBalance(entry.bankId, delta);
    } else if (source.kind === 'additionalIncome') {
      const entry = source.entry;
      const delta = round2(amount - entry.amount);
      const log = month.additionalIncomeLog.map((e) => (e === entry ? { ...e, amount, note: cleanNote, date } : e));
      const total = round2(log.reduce((s, e) => s + (e.amount || 0), 0));
      await db.months.update(month.key, { additionalIncomeLog: log, additionalIncome: total });
      if (entry.bankId && delta) await adjustBankBalance(entry.bankId, delta);
    } else if (source.kind === 'transfer') {
      // Both sides move by the same delta -- editing a transfer's amount
      // just scales the same movement up or down, it doesn't change which
      // two banks were involved.
      const t = source.transfer;
      const delta = round2(amount - t.amount);
      const transfers = month.transfers.map((x) => (x === t ? { ...x, amount, note: cleanNote, date } : x));
      await db.months.update(month.key, { transfers });
      if (delta) {
        await adjustBankBalance(t.fromBankId, -delta);
        await adjustBankBalance(t.toBankId, delta);
      }
    }
  });
}

export async function deleteTaggedEntry(month, source) {
  await db.transaction('rw', db.months, db.banks, db.hutangPots, db.goals, async () => {
    if (source.kind === 'category') {
      const tx = source.tx;
      const net = round2((tx.amount || 0) - (tx.reimbursed || 0));
      const categories = month.categories.map((c) =>
        c.key === source.catKey
          ? { ...c, actual: round2(c.actual - net), transactions: (c.transactions || []).filter((t) => t !== tx) }
          : c
      );
      await db.months.update(month.key, { categories });
      if (source.catKey === 'saving') await adjustSavingPot(month.key, -net);
      // Only `net`, not tx.amount -- any already-reimbursed portion was
      // credited back to the bank when it was marked paid back, so
      // re-crediting the full gross amount here would pay it back twice.
      if (tx.bankId) await adjustBankBalance(tx.bankId, net);
      // Give back whatever this entry had eaten into a goal's reserve --
      // it's not spending anymore, since the entry itself is gone.
      if (tx.bankId) await reconcileGoalReserve(tx.bankId, tx.reserveConsumption);
    } else if (source.kind === 'buffer') {
      const extra = source.extra;
      const extras = month.extras.filter((e) => e !== extra);
      await db.months.update(month.key, { extras });
      // Only the still-outstanding net debit (extra.actual), not the full
      // gross amount -- any already-reimbursed portion was credited back
      // to the bank when it was marked paid back, so re-crediting the
      // gross amount here would pay it back twice.
      if (extra.bankId) await adjustBankBalance(extra.bankId, extra.actual || 0);
      if (extra.bankId) await reconcileGoalReserve(extra.bankId, extra.reserveConsumption);
    } else if (source.kind === 'reimbursement') {
      const entry = source.entry;
      const reimbursements = month.reimbursements.filter((r) => r !== entry);
      await db.months.update(month.key, { reimbursements });
      if (entry.bankId) await adjustBankBalance(entry.bankId, -entry.amount);
    } else if (source.kind === 'additionalIncome') {
      const entry = source.entry;
      const log = month.additionalIncomeLog.filter((e) => e !== entry);
      const total = round2(log.reduce((s, e) => s + (e.amount || 0), 0));
      await db.months.update(month.key, { additionalIncomeLog: log, additionalIncome: total });
      if (entry.bankId) await adjustBankBalance(entry.bankId, -entry.amount);
    } else if (source.kind === 'transfer') {
      const t = source.transfer;
      const transfers = month.transfers.filter((x) => x !== t);
      await db.months.update(month.key, { transfers });
      await adjustBankBalance(t.fromBankId, t.amount);
      await adjustBankBalance(t.toBankId, -t.amount);
    }
  });
}

// The merged view every existing consumer (Home's carousel, Settings'
// Manage Banks sheet, BankFormSheet's edit-mode preview) already expects:
// the persisted {bank, balance, order} plus this cycle's live activity
// folded in under the same field names the mock data originally used.
export const banks = derived([rawBanks, currentMonth, goalsStore], ([$rawBanks, $currentMonth, $goals]) =>
  $rawBanks.map((entry) => ({ ...entry, ...computeBankActivity($currentMonth, $goals, entry.bank.id), reserved: computeBankReserved($goals, entry.bank.id) }))
);

export async function adjustBankBalance(bankId, delta) {
  if (!bankId || !delta) return;
  const entry = await db.banks.get(bankId);
  if (!entry) return;
  await db.banks.update(bankId, { balance: round2(entry.balance + delta) });
}

// Which bank Home's carousel currently shows and Settings' stack shows
// fully expanded. Plain (not persisted) -- purely a UI navigation
// position, resetting to the first bank on reload is harmless.
export const focusedBankIndex = writable(0);

// Whether every bank card's money figures (BankCard.svelte's balance,
// income, spending, reserved, fixed deposit, free-to-spend -- both faces)
// are masked behind dots. ONE shared toggle, not a per-card `hidden` state
// -- tapping the eye on whichever card is in front hides every card in the
// carousel at once, the same way a real banking app's privacy toggle would.
// Persisted via localStorage (not db.meta/Dexie) since this is a pure
// on-this-device display preference, not real app data -- no need for it to
// round-trip through a backup export/import.
const VALUES_HIDDEN_KEY = 'bajetbro_valuesHidden';
function readValuesHidden() {
  try {
    return localStorage.getItem(VALUES_HIDDEN_KEY) === '1';
  } catch {
    return false; // private browsing / storage disabled -- just default open
  }
}
export const valuesHidden = writable(readValuesHidden());
valuesHidden.subscribe((v) => {
  try {
    localStorage.setItem(VALUES_HIDDEN_KEY, v ? '1' : '0');
  } catch {
    // Same as above -- the toggle just won't survive a relaunch here.
  }
});

function uniqueBankId() {
  // crypto.randomUUID() needs a secure context -- unavailable when testing
  // over a plain-HTTP LAN address, so this falls back rather than throwing.
  return 'bank_' + (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// Backfills exactly ONE real bank for an install that already had real
// budget data before db.banks existed -- every pre-multi-bank install
// tracked a single pooled balance, so `month`'s own rolled-forward
// "Remaining" figure becomes that bank's starting balance, not a guess.
// Named generically since there's no real name to infer; the person can
// rename/add real banks afterward from Settings. Shared by seedBanksIfNeeded
// (an existing install loading this code for the first time) and
// importBackup (restoring an old, pre-multi-bank backup) -- both leave
// db.banks empty otherwise, and nothing else ever backfills it.
export async function backfillSingleBank(month) {
  const balance = month ? computeTotalRemaining(month) : 0;
  await db.banks.put({
    bank: { id: uniqueBankId(), name: 'Main account', color: GOAL_COLORS[0], type: 'bank', isMain: true, design: 'classic' },
    balance: round2(balance || 0),
    order: 0,
  });
}

// A genuinely fresh install (no months yet) gets no backfill at all --
// onboarding creates the real first bank instead.
export async function seedBanksIfNeeded() {
  const already = await db.meta.get('banksSeeded');
  if (already?.value) return;
  const [bankCount, monthCount] = await Promise.all([db.banks.count(), db.months.count()]);
  if (bankCount === 0 && monthCount > 0) {
    const current = await db.months.where('closed').equals(0).first();
    await backfillSingleBank(current);
  }
  await db.meta.put({ key: 'banksSeeded', value: true });
}

// Tags every category transaction/buffer extra/reimbursement/additional-
// income entry across ALL months (open and closed alike -- this only adds
// metadata, it never recomputes or moves a balance, so touching closed
// months is harmless) that has no `bankId` yet. Before multi-bank, every
// install only ever tracked one pooled balance, so the single bank
// backfillSingleBank creates for that install IS the one place that money
// was always effectively sitting -- this isn't a guess. Without this, an
// old entry's `if (tx.bankId) adjustBankBalance(...)` guard (see
// updateTaggedEntry/deleteTaggedEntry above, and CategoryDetailSheet/
// BufferDetailSheet's equivalents) just silently no-ops forever, so editing
// or deleting anything logged before this feature existed would never
// touch a bank balance again.
//
// Deliberately scoped to transaction-level entries only, NOT goal
// allocations -- a legacy allocation with no `heldInBankId` key is
// ambiguous (see allocIsReserved in calc.js: it could mean "still
// reserved" or "already given away", depending on the goal's `type`).
// Blindly tagging those here would wrongly make a giving-type goal's
// already-spent money look like it's sitting reserved in this bank.
// Retagging a goal allocation stays a deliberate, per-goal action (see
// Goals.svelte's take-from-goal bank picker) rather than something to do
// silently for everyone.
export async function backfillMissingBankTags(bankId) {
  if (!bankId) return;
  await db.transaction('rw', db.months, async () => {
    const months = await db.months.toArray();
    for (const month of months) {
      let changed = false;
      const tag = (arr) =>
        (arr || []).map((e) => {
          if (e.bankId) return e;
          changed = true;
          return { ...e, bankId };
        });
      const categories = (month.categories || []).map((c) => ({ ...c, transactions: tag(c.transactions) }));
      const extras = tag(month.extras);
      const reimbursements = tag(month.reimbursements);
      const additionalIncomeLog = tag(month.additionalIncomeLog);
      if (changed) await db.months.update(month.key, { categories, extras, reimbursements, additionalIncomeLog });
    }
  });
}

// One-time boot-time pass for an existing install upgrading into
// multi-bank -- runs once (gated the same way seedBanksIfNeeded is), always
// targeting whichever bank is marked `isMain`, falling back to the first
// one by `order` if none is (every backfilled/onboarded install has
// exactly one bank at first, so this is unambiguous in practice).
export async function backfillLegacyBankTags() {
  const already = await db.meta.get('legacyBankTagsBackfilled');
  if (already?.value) return;
  const list = await db.banks.orderBy('order').toArray();
  const target = list.find((b) => b.bank.isMain) || list[0];
  if (!target) return; // no bank yet to tag onto -- try again next boot
  await backfillMissingBankTags(target.bank.id);
  await db.meta.put({ key: 'legacyBankTagsBackfilled', value: true });
}

// The current open month's own salaryCredit (see confirmStartCycle's own
// comment in EndMonthSheet.svelte on why computeBankActivity needs this) --
// an install whose cycle was already running before this field existed
// would otherwise have every closed month's reconstructed Start/Balance for
// the main bank skewed the moment the NEXT cycle starts, same as if this
// fix had never shipped. Not gated by a one-time meta flag like the other
// backfills here -- whether the open month already has one IS the
// idempotency check, and it's cheap enough to just run every boot.
//
// Known imprecise for a month whose bank balance was seeded from the old
// single-pool remainder mid-cycle (see backfillSingleBank) rather than a
// real confirmStartCycle salary credit -- there's no signal here to tell
// that case apart from "this really did happen, the field just didn't
// exist yet to record it," so it's treated the same as the latter. Kept
// anyway on the user's own call: the salary is genuinely real income
// either way, and this only ever affects the one month straddling
// multi-bank's own introduction, not anything ongoing.
export async function backfillSalaryCredit() {
  const current = await db.months.where('closed').equals(0).first();
  if (!current || current.salaryCredit !== undefined) return;
  const list = await db.banks.orderBy('order').toArray();
  const mainBank = list.find((b) => b.bank.isMain) || list[0];
  if (!mainBank) return;
  await db.months.update(current.key, {
    salaryCredit: {
      date: current.startedAt || new Date().toISOString(),
      amount: round2((current.income || 0) + (current.bonus || 0)),
      bankId: mainBank.bank.id,
    },
  });
}

export async function addBank({ name, balance = 0, fixedDeposit = 0, type = 'bank', isMain = false, color, icon = null, logo = null, design = 'classic' }) {
  const list = await db.banks.orderBy('order').toArray();
  const resolvedColor = color ?? GOAL_COLORS[list.length % GOAL_COLORS.length];
  // Only one bank can be "main" at a time -- picking a new one un-sets it
  // on whichever bank held it before.
  if (isMain) {
    await Promise.all(
      list.filter((b) => b.bank.isMain).map((b) => db.banks.update(b.bank.id, { bank: { ...b.bank, isMain: false } }))
    );
  }
  const entry = {
    bank: { id: uniqueBankId(), name, color: resolvedColor, type, isMain, icon, logo, design },
    balance,
    fixedDeposit: round2(fixedDeposit || 0),
    order: list.length,
  };
  await db.banks.put(entry);
  // A brand-new bank starting with real money in it adds to this cycle's
  // pool the same way -- see adjustCycleBaseline. Only the FREE slice of
  // it, though (balance minus fixedDeposit) -- computeBankFreeTotal (Home's
  // leftover, Buffer, everywhere else "how much do I actually have" is
  // computed) always excludes fixed deposit as locked/unspendable, so
  // Income crediting the full balance here would count money that every
  // other figure in the app already treats as out of reach.
  await adjustCycleBaseline(round2(balance - (entry.fixedDeposit || 0)));
  focusedBankIndex.set(list.length);
  return entry;
}

// Single entry point for editing an existing bank -- shares its field set
// with addBank (name/balance/fixedDeposit/type/isMain/color/icon/logo/design)
// so the add and edit forms can be the exact same component. `balance` is
// only ever hand-edited here while the bank has no history yet (see
// bankHasHistory -- BankFormFields locks the field once it does), so any
// change in it is a correction to the starting number itself, not a real
// transaction -- see adjustCycleBaseline.
export async function updateBank(index, { name, balance, fixedDeposit = 0, type, isMain, color, icon, logo, design }) {
  const list = await db.banks.orderBy('order').toArray();
  const target = list[index];
  if (!target) return;
  // Same free-slice-only reasoning as addBank -- compare FREE balance
  // (balance minus fixedDeposit) before and after, not the raw balance
  // delta, so marking part of an existing setup-time balance as a fixed
  // deposit (or un-marking it) moves Income by exactly what actually
  // became spendable/locked, not by whatever the raw Balance field says.
  const oldFree = round2((target.balance || 0) - (target.fixedDeposit || 0));
  const newFree = round2((balance ?? target.balance) - (fixedDeposit || 0));
  const freeDelta = round2(newFree - oldFree);
  if (isMain) {
    await Promise.all(
      list
        .filter((b) => b.bank.id !== target.bank.id && b.bank.isMain)
        .map((b) => db.banks.update(b.bank.id, { bank: { ...b.bank, isMain: false } }))
    );
  }
  await db.banks.update(target.bank.id, {
    balance,
    fixedDeposit: round2(fixedDeposit || 0),
    bank: { ...target.bank, name, type, isMain, color, icon, logo, design },
  });
  await adjustCycleBaseline(freeDelta);
}

// `promoteMainId`: when deleting the main bank, every other place that
// falls back to "the main bank" (AddExpenseSheet's default Paid-from,
// EndMonthSheet's salary deposit, etc.) would otherwise silently start
// falling back to banksList[0] instead -- whichever bank happens to sort
// first, not a real choice. Passing the id the user actually picked as the
// replacement (see BankFormSheet.svelte's delete-confirm UI) sets isMain on
// it in the same transaction as the delete, so there's never a moment with
// no main bank at all.
export async function deleteBank(index, { promoteMainId } = {}) {
  const list = await db.banks.orderBy('order').toArray();
  const target = list[index];
  if (!target) return;
  await db.banks.delete(target.bank.id);
  // Reverses whatever free balance this bank ever credited to Income (see
  // addBank/updateBank's adjustCycleBaseline calls) -- otherwise deleting a
  // bank makes its money vanish from tracking while Income keeps counting
  // it forever. Uses the bank's CURRENT free balance (balance minus
  // fixedDeposit, floored at 0), not whatever was originally credited --
  // real transactions since then (spends, transfers, additional income)
  // already moved Income/balance correctly on their own, so this only
  // needs to undo the slice that's disappearing right now.
  await adjustCycleBaseline(-round2(Math.max(0, (target.balance || 0) - (target.fixedDeposit || 0))));
  // Re-number `order` for the rest so it stays a clean, gapless sequence.
  const remaining = list.filter((b) => b.bank.id !== target.bank.id);
  await Promise.all(remaining.map((b, i) => db.banks.update(b.bank.id, { order: i })));
  if (promoteMainId) {
    const promote = remaining.find((b) => b.bank.id === promoteMainId);
    if (promote) await db.banks.update(promote.bank.id, { bank: { ...promote.bank, isMain: true } });
  }
  focusedBankIndex.update((i) => Math.max(0, i >= index ? i - 1 : i));
}
