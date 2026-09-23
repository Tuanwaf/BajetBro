import db from './db';
import { migrateV1 } from './migrate.js';
import { initPersonalizationFlags } from './personalization.js';
import { endTour } from './tour.js';
import { backfillSingleBank, backfillMissingBankTags, backfillSalaryCredit } from './bankPreviewStore.js';
import { computeStreak } from './streak.js';

// v3 -- adds `banks` (see feature/multi-bank, db.js v4). A v1/v2 backup has
// no bank list at all; importing one backfills a single real bank right
// away (see backfillSingleBank below) rather than leaving db.banks empty
// until the next app boot -- the app keeps running live after import
// (no forced reload), so an empty bank list would otherwise be a real,
// if brief, broken state, not just a theoretical one.
const SCHEMA_VERSION = 3;

export async function exportBackup() {
  const [template, months, hutangPots, tabungHaji, dividends, goals, savingsSpends, loans, banks, givingGoalsEnabled, tabungHajiEnabled, streakDaysRec] = await Promise.all([
    db.template.get('current'),
    db.months.toArray(),
    db.hutangPots.toArray(),
    db.tabungHaji.get('main'),
    db.dividends.toArray(),
    db.goals.toArray(),
    db.savingsSpends.toArray(),
    db.loans.toArray(),
    db.banks.toArray(),
    db.meta.get('givingGoalsEnabled'),
    db.meta.get('tabungHajiEnabled'),
    db.meta.get('streakDays'),
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
    loans,
    banks,
    givingGoalsEnabled: !!givingGoalsEnabled?.value,
    tabungHajiEnabled: !!tabungHajiEnabled?.value,
    streakDays: streakDaysRec?.value ?? [],
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

  if (data.schemaVersion !== 1 && data.schemaVersion !== 2 && data.schemaVersion !== 3) {
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

  const loans = data.loans || [];
  // A v1/v2 backup predates the bank list entirely -- leaving db.banks empty
  // after import isn't a loss (there was nothing to restore), and
  // seedBanksIfNeeded() backfills one real bank from the just-restored
  // months on next load, same as any other pre-multi-bank install.
  const banks = data.banks || [];

  await db.transaction(
    'rw',
    db.template,
    db.months,
    db.hutangPots,
    db.tabungHaji,
    db.dividends,
    db.goals,
    db.savingsSpends,
    db.loans,
    db.banks,
    db.meta,
    async () => {
      await Promise.all([
        db.template.clear(),
        db.months.clear(),
        db.hutangPots.clear(),
        db.dividends.clear(),
        db.goals.clear(),
        db.savingsSpends.clear(),
        db.loans.clear(),
        db.banks.clear(),
      ]);

      if (data.template) await db.template.put(data.template);
      if (data.months?.length) await db.months.bulkPut(data.months);
      if (pots.length) await db.hutangPots.bulkPut(pots);
      if (data.tabungHaji) await db.tabungHaji.put(data.tabungHaji);
      if (data.dividends?.length) await db.dividends.bulkPut(data.dividends);
      if (goals.length) await db.goals.bulkPut(goals);
      if (savingsSpends.length) await db.savingsSpends.bulkAdd(savingsSpends.map(({ id, ...rest }) => rest));
      if (loans.length) await db.loans.bulkAdd(loans.map(({ id, ...rest }) => rest));
      if (banks.length) {
        await db.banks.bulkPut(banks);
      } else {
        // A v1/v2 backup (or any export with no banks) leaves db.banks
        // empty otherwise -- backfill one real bank from the restored
        // current month right now, same idea as seedBanksIfNeeded() but not
        // deferred to the next boot, since the app keeps running live here.
        const restoredCurrent = (data.months || []).find((m) => !m.closed);
        if (restoredCurrent) await backfillSingleBank(restoredCurrent);
      }

      // A restored backup already has real data -- mark seeded so the
      // historical seed script never overwrites it on a future load.
      await db.meta.put({ key: 'seeded', value: true });
      // Only mark banks seeded when db.banks actually ended up with
      // something -- if there was no open month to backfill from either
      // (rare), leave this unset so seedBanksIfNeeded() gets another chance
      // once a month exists.
      const bankList = await db.banks.orderBy('order').toArray();
      if (bankList.length > 0) await db.meta.put({ key: 'banksSeeded', value: true });

      // Import just replaced db.months wholesale, so backfillLegacyBankTags'
      // own one-time flag can't be trusted here -- an old v1/v2 backup
      // restored on top of an already-migrated install would otherwise be
      // skipped and left with untagged transactions. Run the tagging pass
      // directly (unconditionally) instead, targeting the same bank
      // seedBanksIfNeeded/backfillLegacyBankTags would pick.
      const mainBank = bankList.find((b) => b.bank.isMain) || bankList[0];
      if (mainBank) {
        await backfillMissingBankTags(mainBank.bank.id);
        await db.meta.put({ key: 'legacyBankTagsBackfilled', value: true });
      }

      if (data.givingGoalsEnabled) await db.meta.put({ key: 'givingGoalsEnabled', value: true });
      if (data.tabungHajiEnabled) await db.meta.put({ key: 'tabungHajiEnabled', value: true });
      // Older backups predate streaks -- leave whatever this device has.
      if (Array.isArray(data.streakDays)) {
        await db.meta.put({ key: 'streakDays', value: data.streakDays });
        // Count every freeze in the imported history as already seen, so the
        // Home card doesn't play a freeze animation for old gaps.
        await db.meta.put({ key: 'streakFreezesSeen', value: computeStreak(data.streakDays).freezesUsed });
      }
    }
  );

  // Same reasoning as backfillMissingBankTags above -- this only runs at
  // app boot (main.js) otherwise, so a backup restored mid-session (no
  // reload in between) would leave the freshly-imported current month
  // missing salaryCredit until the next relaunch, showing its Start figure
  // short by exactly its salary until then.
  await backfillSalaryCredit();

  // Fallback for backups exported before these flags existed -- infers them
  // from the restored data itself (e.g. an existing giving-type goal).
  await initPersonalizationFlags(db);

  // A restored backup means this isn't a fresh install -- if the guided
  // tour auto-started before the import happened (empty DB, no month yet),
  // stop it rather than leaving it stuck showing onboarding steps.
  await endTour(true);
}
