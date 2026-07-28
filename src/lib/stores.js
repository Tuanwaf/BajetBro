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
