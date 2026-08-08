import Dexie from 'dexie';
import { migrateV1 } from './migrate.js';

export const db = new Dexie('BajetBroDB');

// Booleans aren't valid IndexedDB index keys, so `closed` is stored as 0/1.
db.version(1).stores({
  template: 'id',
  months: '&key, order, closed',
  hutangPots: '&month',
  hutangLedger: 'id',
  tabungHaji: 'id',
  dividends: '++id, date',
  meta: 'key',
});

// v2 -- the Goals model. The single hutang ledger + per-pot send/used are
// replaced by a `goals` table (each with its own allocation + spend ledgers)
// and a `savingsSpends` table (personal spends drawn from the pool). Pots keep
// only `initial` -- the saving inflow that feeds the shared pool.
db.version(2)
  .stores({
    template: 'id',
    months: '&key, order, closed',
    hutangPots: '&month',
    hutangLedger: 'id',
    tabungHaji: 'id',
    dividends: '++id, date',
    goals: '&id, order',
    savingsSpends: '++id, date',
    meta: 'key',
  })
  .upgrade(async (tx) => {
    const pots = await tx.table('hutangPots').toArray();
    const ledger = await tx.table('hutangLedger').get('master');
    const { goals, savingsSpends, hutangPots } = migrateV1({ hutangPots: pots, hutangLedger: ledger });
    if (goals.length) await tx.table('goals').bulkPut(goals);
    if (savingsSpends.length) await tx.table('savingsSpends').bulkAdd(savingsSpends);
    await tx.table('hutangPots').clear();
    if (hutangPots.length) await tx.table('hutangPots').bulkPut(hutangPots);
  });

// v3 -- Loan log: a manual, freestanding record of money lent to or borrowed
// from other people. Purely informational -- never touches budget/expense
// calculations, so it needs no migration of existing data.
db.version(3).stores({
  template: 'id',
  months: '&key, order, closed',
  hutangPots: '&month',
  hutangLedger: 'id',
  tabungHaji: 'id',
  dividends: '++id, date',
  goals: '&id, order',
  savingsSpends: '++id, date',
  loans: '++id, date',
  meta: 'key',
});

// v4 -- the bank list itself (see feature/multi-bank), so onboarding's
// "add your main bank" step actually persists instead of living only in
// bankPreviewStore.js's in-memory writable. Each record keeps the same
// nested shape that store already used ({bank:{id,name,color,...},
// balance, income, spending, transactions}) -- IndexedDB keyPaths support
// dotted paths, so 'bank.id' works fine as the primary key without
// flattening every consumer's `entry.bank.*` reads. Transaction-level bank
// tagging and the full ledger migration are still not part of this --
// just the list, which is the minimum onboarding needs.
db.version(4).stores({
  template: 'id',
  months: '&key, order, closed',
  hutangPots: '&month',
  hutangLedger: 'id',
  tabungHaji: 'id',
  dividends: '++id, date',
  goals: '&id, order',
  savingsSpends: '++id, date',
  loans: '++id, date',
  banks: '&bank.id, order',
  meta: 'key',
});

export default db;
