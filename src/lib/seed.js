// One-time blank-slate seed: sets up the fixed-category template with no
// planned amounts and no history. Real historical data is restored via
// Settings -> Import JSON from a personal backup file (never committed).

const CATEGORY_META = [
  { name: 'Sewa rumah', color: '#4F86F7' },
  { name: 'Bill Phone', color: '#F2994A' },
  { name: 'Minyak motor', color: '#EB5757' },
  { name: 'Makan', color: '#2D9CDB' },
  { name: 'Saving', color: '#9B51E0' },
  { name: 'Spotify', color: '#1DB954' },
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
      });

      await db.hutangLedger.put({ id: 'master', initial: 0 });
      await db.tabungHaji.put({ id: 'main', fixedDeposit: 0 });

      await db.meta.put({ key: 'seeded', value: true });
    }
  );
}
