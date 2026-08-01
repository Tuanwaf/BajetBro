// Some features (giving-type goals, the Tabung Haji "Where it grows" section)
// are specific to one person's own financial setup, not something a fresh
// install should see by default. Rather than removing them from the shared
// code -- which would remove them for everyone, including the person who
// actually uses them -- they're gated behind a flag stored in this device's
// own local database. A brand-new install has no such flag and starts
// without them; a device that already has matching data gets grandfathered
// in automatically, so nothing changes for an existing user. Both flags
// travel with a backup export.
export async function initPersonalizationFlags(db) {
  const [givingFlag, thFlag, nameFlag, goalList, th, dividendCount, monthCount] = await Promise.all([
    db.meta.get('givingGoalsEnabled'),
    db.meta.get('tabungHajiEnabled'),
    db.meta.get('userName'),
    db.goals.toArray(),
    db.tabungHaji.get('main'),
    db.dividends.count(),
    db.months.count(),
  ]);

  if (!givingFlag) {
    const hasGivingGoal = goalList.some((g) => g.type === 'giving');
    if (hasGivingGoal) await db.meta.put({ key: 'givingGoalsEnabled', value: true });
  }

  if (!thFlag) {
    const hasThData = (th?.fixedDeposit || 0) > 0 || dividendCount > 0;
    if (hasThData) await db.meta.put({ key: 'tabungHajiEnabled', value: true });
  }

  // The Home greeting used to be hardcoded to "Wafiq". A device that already
  // has a month predates the onboarding flow that now asks for a name, so it
  // gets grandfathered in rather than suddenly greeting with no name at all.
  if (!nameFlag && monthCount > 0) {
    await db.meta.put({ key: 'userName', value: 'Wafiq' });
  }
}
