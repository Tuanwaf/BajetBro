import db from './db';

const SCHEMA_VERSION = 1;

export async function exportBackup() {
  const [template, months, hutangPots, hutangLedger, tabungHaji, dividends] = await Promise.all([
    db.template.get('current'),
    db.months.toArray(),
    db.hutangPots.toArray(),
    db.hutangLedger.get('master'),
    db.tabungHaji.get('main'),
    db.dividends.toArray(),
  ]);

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    template,
    months,
    hutangPots,
    hutangLedger,
    tabungHaji,
    dividends,
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

  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported backup schema version: ${data.schemaVersion}`);
  }

  await db.transaction(
    'rw',
    db.template,
    db.months,
    db.hutangPots,
    db.hutangLedger,
    db.tabungHaji,
    db.dividends,
    db.meta,
    async () => {
      await Promise.all([
        db.template.clear(),
        db.months.clear(),
        db.hutangPots.clear(),
        db.dividends.clear(),
      ]);

      if (data.template) await db.template.put(data.template);
      if (data.months?.length) await db.months.bulkPut(data.months);
      if (data.hutangPots?.length) await db.hutangPots.bulkPut(data.hutangPots);
      if (data.hutangLedger) await db.hutangLedger.put(data.hutangLedger);
      if (data.tabungHaji) await db.tabungHaji.put(data.tabungHaji);
      if (data.dividends?.length) await db.dividends.bulkPut(data.dividends);

      // A restored backup already has real data — mark seeded so the
      // historical seed script never overwrites it on a future load.
      await db.meta.put({ key: 'seeded', value: true });
    }
  );
}
