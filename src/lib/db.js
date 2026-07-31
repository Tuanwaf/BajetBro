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

export default db;
