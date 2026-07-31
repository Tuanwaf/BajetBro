import { round2 } from './calc.js';

// Convert the pre-Goals (v1) data shape into the Goals model. Used both by the
// Dexie version(2) upgrade (for an installed DB) and by importBackup (for an
// old backup file), so the two paths always produce identical results.
//
// - The single hutang ledger becomes ONE goal, "Personal Goal" (giving type):
//   its target is the recorded ledger amount, and its allocations are
//   reconstructed from each pot's `send` so the paid-down history carries over.
// - Each pot's `used` (money kept / spent on yourself) becomes a personal
//   savings-spend entry, so that history is preserved too.
// - Pots keep only `initial` going forward -- that's the saving inflow that
//   feeds the shared "Ready to allocate" pool; `used`/`send` are retired.
export function migrateV1({ hutangPots = [], hutangLedger } = {}) {
  const pots = hutangPots || [];

  const allocations = pots
    .filter((p) => (p.send || 0) > 0)
    .map((p) => ({ date: p.month, amount: round2(p.send) }));

  const personalGoal = {
    id: 'personal',
    label: 'Personal Goal',
    type: 'giving',
    color: '#f2557a',
    order: 0,
    target: round2(hutangLedger?.initial || 0),
    currency: null,
    rate: null,
    closed: 0,
    allocations,
    spends: [],
  };

  const savingsSpends = pots
    .filter((p) => (p.used || 0) > 0)
    .map((p) => ({ date: p.month, label: 'Used (before Goals)', amount: round2(p.used) }));

  const cleanPots = pots.map((p) => ({ month: p.month, initial: p.initial }));

  // Only create the Personal Goal if there was actually a debt recorded;
  // a fresh/blank install (no ledger) starts with no goals at all.
  const goals = personalGoal.target > 0 || allocations.length ? [personalGoal] : [];

  return { goals, savingsSpends, hutangPots: cleanPots };
}
