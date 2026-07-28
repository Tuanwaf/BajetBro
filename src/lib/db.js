import Dexie from 'dexie';

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

export default db;
