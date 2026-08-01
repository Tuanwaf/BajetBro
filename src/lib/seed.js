// One-time blank-slate seed: sets up the fixed-category template with no
// planned amounts and no history. Real historical data is restored via
// Settings -> Import JSON from a personal backup file (never committed).

import { BUFFER_LABEL_PRESETS } from './constants.js';

const CATEGORY_META = [
  { key: 'rent', name: 'Sewa rumah', color: '#6e8bff' },
  { key: 'phone', name: 'Bill Phone', color: '#38c6d9' },
  { key: 'petrol', name: 'Minyak motor', color: '#f2994a' },
  { key: 'food', name: 'Makan', color: '#c084f5' },
  { key: 'spotify', name: 'Spotify', color: '#3ddc97' },
  { key: 'saving', name: 'Saving', color: '#e7b34e' },
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
