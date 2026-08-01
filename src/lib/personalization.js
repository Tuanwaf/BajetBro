// Some features (giving-type goals, the Tabung Haji "Where it grows" section)
// are specific to one person's own financial setup, not something a fresh
// install should see by default. Rather than removing them from the shared
// code -- which would remove them for everyone, including the person who
// actually uses them -- they're gated behind a flag stored in this device's
// own local database. A brand-new install has no such flag and starts
// without them; a device that already has matching data gets grandfathered
// in automatically, so nothing changes for an existing user. Both flags can
// also be flipped by hand in Settings, and both travel with a backup export.
export async function initPersonalizationFlags(db) {
  const [givingFlag, thFlag, goalList, th, dividendCount] = await Promise.all([
    db.meta.get('givingGoalsEnabled'),
    db.meta.get('tabungHajiEnabled'),
    db.goals.toArray(),
    db.tabungHaji.get('main'),
    db.dividends.count(),
  ]);

  if (!givingFlag) {
    const hasGivingGoal = goalList.some((g) => g.type === 'giving');
    if (hasGivingGoal) await db.meta.put({ key: 'givingGoalsEnabled', value: true });
  }

  if (!thFlag) {
    const hasThData = (th?.fixedDeposit || 0) > 0 || dividendCount > 0;
    if (hasThData) await db.meta.put({ key: 'tabungHajiEnabled', value: true });
  }
}
