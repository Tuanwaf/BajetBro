// One-time blank-slate seed: sets up the fixed-category template with no
// planned amounts and no history. Real historical data is restored via
// Settings -> Import JSON from a personal backup file (never committed).

import { BUFFER_LABEL_PRESETS } from './constants.js';

// No longer includes a pre-seeded "Saving" row -- it used to ship locked
// and undeletable in Onboarding, which nobody could actually remove even if
// they didn't want it. The pool-funding behavior a category named "Saving"
// gets (see categories.js's comment, and CategoryDetailSheet/
// bankPreviewStore.js's `key === 'saving'` checks) is keyed purely on that
// string, not a flag set here -- anyone who wants it can still just add a
// category and name it "Saving" themselves, the same way any other
// category is added.
const CATEGORY_META = [
  { key: 'rent', name: 'Sewa rumah', color: '#6e8bff' },
  { key: 'phone', name: 'Bill Phone', color: '#38c6d9' },
  { key: 'petrol', name: 'Minyak motor', color: '#f2994a' },
  { key: 'food', name: 'Makan', color: '#c084f5' },
];

export async function seedIfNeeded(db) {
  const already = await db.meta.get('seeded');
  if (already?.value) return;

  await db.transaction(
    'rw',
    db.template,
    db.hutangLedger,
    db.tabungHaji,
    db.meta,
    async () => {
      await db.template.put({
        id: 'current',
        categories: CATEGORY_META.map((c) => ({ ...c, planned: 0 })),
        bufferLabels: [...BUFFER_LABEL_PRESETS],
      });

      await db.hutangLedger.put({ id: 'master', initial: 0 });
      await db.tabungHaji.put({ id: 'main', fixedDeposit: 0 });

      await db.meta.put({ key: 'seeded', value: true });
    }
  );
}
