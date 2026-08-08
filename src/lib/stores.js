import { liveQuery } from 'dexie';
import { readable } from 'svelte/store';
import db from './db';

function fromLiveQuery(queryFn, initial) {
  return readable(initial, (set) => {
    const sub = liveQuery(queryFn).subscribe({
      next: set,
      error: (e) => console.error('[BajetBro] live query failed:', e),
    });
    return () => sub.unsubscribe();
  });
}

export const template = fromLiveQuery(() => db.template.get('current'), null);

export const currentMonth = fromLiveQuery(
  () => db.months.where('closed').equals(0).first(),
  null
);

export const closedMonths = fromLiveQuery(
  () => db.months.where('closed').equals(1).sortBy('order'),
  []
);

export const hutangPots = fromLiveQuery(() => db.hutangPots.toArray(), []);

export const hutangLedger = fromLiveQuery(() => db.hutangLedger.get('master'), null);

export const tabungHaji = fromLiveQuery(() => db.tabungHaji.get('main'), null);

export const dividends = fromLiveQuery(
  () => db.dividends.orderBy('date').reverse().toArray(),
  []
);

export const goals = fromLiveQuery(() => db.goals.orderBy('order').toArray(), []);

// The bank list -- see feature/multi-bank. Real persistence (db.banks), not
// mock data; bankPreviewStore.js re-exports this alongside the mutating
// functions (addBank/updateBank/deleteBank) that write through to it.
export const banks = fromLiveQuery(() => db.banks.orderBy('order').toArray(), []);

export const savingsSpends = fromLiveQuery(
  () => db.savingsSpends.orderBy('date').reverse().toArray(),
  []
);

export const loans = fromLiveQuery(() => db.loans.orderBy('date').reverse().toArray(), []);

// Personalization flags -- gate features specific to one person's own setup
// (see lib/personalization.js) rather than showing them to every fresh
// install. Stored per-device, so they never affect anyone else's data.
export const givingGoalsEnabled = fromLiveQuery(async () => !!(await db.meta.get('givingGoalsEnabled'))?.value, false);
export const tabungHajiEnabled = fromLiveQuery(async () => !!(await db.meta.get('tabungHajiEnabled'))?.value, false);

export const userName = fromLiveQuery(async () => (await db.meta.get('userName'))?.value || '', '');
