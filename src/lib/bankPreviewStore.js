// Bank list -- persisted to Dexie (db.banks, see db.js v4), not mock data
// anymore. Kept as its own module (rather than folded fully into
// stores.js) since Settings' "Manage banks" sheet, Home's carousel, and
// now OnboardingFlow all need the same mutating functions, not just the
// live data. Transaction-level bank tagging and the full ledger migration
// are still not part of this (see feature/multi-bank) -- just the bank
// list itself, which is the minimum onboarding needs to actually persist.
import { writable } from 'svelte/store';
import db from './db.js';
import { banks } from './stores.js';
import { GOAL_COLORS } from './constants.js';

export { banks };

// Which bank Home's carousel currently shows and Settings' stack shows
// fully expanded. Plain (not persisted) -- purely a UI navigation
// position, resetting to the first bank on reload is harmless.
export const focusedBankIndex = writable(0);

// What every install had before db.banks existed -- backfilled once for
// installs that already have real budget data (see seedBanksIfNeeded), so
// this dev's own in-progress install doesn't suddenly show zero banks. A
// genuinely fresh install gets none of these; onboarding creates the real
// first bank instead.
const LEGACY_SEED_BANKS = [
  {
    bank: { id: 'maybank', name: 'Maybank', color: '#6e8bff', type: 'bank', isMain: true, design: 'classic' },
    balance: 4515,
    income: 3200,
    spending: 835,
    transactions: [
      { note: 'Salary', date: 'Aug 1', amount: 3200, income: true, color: 'var(--good)' },
      { note: 'Rent', date: 'Aug 1', amount: 800, income: false, color: '#6e8bff' },
      { note: 'Lunch', date: 'Aug 3', amount: 35, income: false, color: '#c084f5' },
    ],
  },
  {
    bank: { id: 'tng', name: 'TNG eWallet', color: '#38c6d9', type: 'ewallet', isMain: false, design: 'classic' },
    balance: 138,
    income: 0,
    spending: 12,
    transactions: [
      { note: 'Parking', date: 'Aug 4', amount: 12, income: false, color: 'var(--red)' },
    ],
  },
  {
    bank: { id: 'grabpay', name: 'GrabPay', color: '#f2994a', type: 'ewallet', isMain: false, design: 'classic' },
    balance: 42.5,
    income: 50,
    spending: 7.5,
    transactions: [
      { note: 'Top up', date: 'Aug 2', amount: 50, income: true, color: 'var(--good)' },
      { note: 'GrabFood', date: 'Aug 5', amount: 7.5, income: false, color: '#c084f5' },
    ],
  },
  {
    bank: { id: 'cimb', name: 'CIMB Bank', color: '#c084f5', type: 'bank', isMain: false, design: 'classic' },
    balance: 980,
    income: 0,
    spending: 45,
    transactions: [
      { note: 'Netflix', date: 'Aug 3', amount: 45, income: false, color: '#c084f5' },
    ],
  },
  {
    bank: { id: 'shopeepay', name: 'ShopeePay', color: '#f2557a', type: 'ewallet', isMain: false, design: 'classic' },
    balance: 25,
    income: 0,
    spending: 18,
    transactions: [
      { note: 'Shopee order', date: 'Aug 6', amount: 18, income: false, color: '#f2557a' },
    ],
  },
  {
    bank: { id: 'publicbank', name: 'Public Bank', color: '#e7b34e', type: 'bank', isMain: false, design: 'classic' },
    balance: 1560,
    income: 0,
    spending: 0,
    transactions: [],
  },
];

export async function seedBanksIfNeeded() {
  const already = await db.meta.get('banksSeeded');
  if (already?.value) return;
  const [bankCount, monthCount] = await Promise.all([db.banks.count(), db.months.count()]);
  // Only backfill an install that already had real budget data before this
  // table existed -- a genuinely fresh install (no months yet) starts with
  // zero banks, so onboarding's "add your main bank" step is what creates
  // the first real one, not a pile of unrelated presets.
  if (bankCount === 0 && monthCount > 0) {
    await db.banks.bulkPut(LEGACY_SEED_BANKS.map((b, i) => ({ ...b, order: i })));
  }
  await db.meta.put({ key: 'banksSeeded', value: true });
}

function uniqueBankId() {
  // crypto.randomUUID() needs a secure context -- unavailable when testing
  // over a plain-HTTP LAN address, so this falls back rather than throwing.
  return 'bank_' + (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

export async function addBank({ name, balance = 0, type = 'bank', isMain = false, color, icon = null, logo = null, design = 'classic' }) {
  const list = await db.banks.orderBy('order').toArray();
  const resolvedColor = color ?? GOAL_COLORS[list.length % GOAL_COLORS.length];
  // Only one bank can be "main" at a time -- picking a new one un-sets it
  // on whichever bank held it before.
  if (isMain) {
    await Promise.all(
      list.filter((b) => b.bank.isMain).map((b) => db.banks.update(b.bank.id, { bank: { ...b.bank, isMain: false } }))
    );
  }
  const entry = {
    bank: { id: uniqueBankId(), name, color: resolvedColor, type, isMain, icon, logo, design },
    balance,
    income: 0,
    spending: 0,
    transactions: [],
    order: list.length,
  };
  await db.banks.put(entry);
  focusedBankIndex.set(list.length);
  return entry;
}

// Single entry point for editing an existing bank -- shares its field set
// with addBank (name/balance/type/isMain/color/icon/logo/design) so the
// add and edit forms can be the exact same component.
export async function updateBank(index, { name, balance, type, isMain, color, icon, logo, design }) {
  const list = await db.banks.orderBy('order').toArray();
  const target = list[index];
  if (!target) return;
  if (isMain) {
    await Promise.all(
      list
        .filter((b) => b.bank.id !== target.bank.id && b.bank.isMain)
        .map((b) => db.banks.update(b.bank.id, { bank: { ...b.bank, isMain: false } }))
    );
  }
  await db.banks.update(target.bank.id, {
    balance,
    bank: { ...target.bank, name, type, isMain, color, icon, logo, design },
  });
}

export async function deleteBank(index) {
  const list = await db.banks.orderBy('order').toArray();
  const target = list[index];
  if (!target) return;
  await db.banks.delete(target.bank.id);
  // Re-number `order` for the rest so it stays a clean, gapless sequence.
  const remaining = list.filter((b) => b.bank.id !== target.bank.id);
  await Promise.all(remaining.map((b, i) => db.banks.update(b.bank.id, { order: i })));
  focusedBankIndex.update((i) => Math.max(0, i >= index ? i - 1 : i));
}
