import db from './db';
import { migrateV1 } from './migrate.js';

const SCHEMA_VERSION = 2;

export async function exportBackup() {
  const [template, months, hutangPots, tabungHaji, dividends, goals, savingsSpends] = await Promise.all([
    db.template.get('current'),
    db.months.toArray(),
    db.hutangPots.toArray(),
    db.tabungHaji.get('main'),
    db.dividends.toArray(),
    db.goals.toArray(),
    db.savingsSpends.toArray(),
  ]);

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    template,
    months,
    hutangPots,
    tabungHaji,
    dividends,
    goals,
    savingsSpends,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bajetbro-backup-${payload.exportedAt.slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importBackup(file) {
  const raw = await file.text();
  // Some mobile share/transfer paths (AirDrop, cloud sync, messaging apps)
  // prepend a UTF-8 BOM, which breaks JSON.parse if left in.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new Error(`Not valid JSON (${err.message})`);
  }

  if (data.schemaVersion !== 1 && data.schemaVersion !== 2) {
    throw new Error(`Unsupported backup schema version: ${data.schemaVersion}`);
  }

  // A v1 backup predates Goals -- fold its hutang ledger + pots into the new
  // goals / savingsSpends shape so old backups restore losslessly.
  let goals = data.goals || [];
  let savingsSpends = data.savingsSpends || [];
  let pots = data.hutangPots || [];
  if (data.schemaVersion === 1) {
    const migrated = migrateV1({ hutangPots: pots, hutangLedger: data.hutangLedger });
    goals = migrated.goals;
    savingsSpends = migrated.savingsSpends;
    pots = migrated.hutangPots;
  }

  await db.transaction(
    'rw',
    db.template,
    db.months,
    db.hutangPots,
    db.tabungHaji,
    db.dividends,
    db.goals,
    db.savingsSpends,
    db.meta,
    async () => {
      await Promise.all([
        db.template.clear(),
        db.months.clear(),
        db.hutangPots.clear(),
        db.dividends.clear(),
        db.goals.clear(),
        db.savingsSpends.clear(),
      ]);

      if (data.template) await db.template.put(data.template);
      if (data.months?.length) await db.months.bulkPut(data.months);
      if (pots.length) await db.hutangPots.bulkPut(pots);
      if (data.tabungHaji) await db.tabungHaji.put(data.tabungHaji);
      if (data.dividends?.length) await db.dividends.bulkPut(data.dividends);
      if (goals.length) await db.goals.bulkPut(goals);
      if (savingsSpends.length) await db.savingsSpends.bulkAdd(savingsSpends.map(({ id, ...rest }) => rest));

      // A restored backup already has real data -- mark seeded so the
      // historical seed script never overwrites it on a future load.
      await db.meta.put({ key: 'seeded', value: true });
    }
  );
}
