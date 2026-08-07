// Multi-bank preview -- local dev only, mock data, not wired to the real
// schema yet (see feature/multi-bank branch). Lifted out of Home.svelte into
// a shared store so Settings' "Manage banks" sheet and Home's carousel stay
// in sync -- picking a bank as the focus in one place reflects in the other.
import { writable } from 'svelte/store';
import { GOAL_COLORS } from './constants.js';

export const banks = writable([
  {
    bank: { id: 'maybank', name: 'Maybank', color: '#6e8bff' },
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
    bank: { id: 'tng', name: 'TNG eWallet', color: '#38c6d9' },
    balance: 138,
    income: 0,
    spending: 12,
    transactions: [
      { note: 'Parking', date: 'Aug 4', amount: 12, income: false, color: 'var(--red)' },
    ],
  },
  {
    bank: { id: 'grabpay', name: 'GrabPay', color: '#f2994a' },
    balance: 42.5,
    income: 50,
    spending: 7.5,
    transactions: [
      { note: 'Top up', date: 'Aug 2', amount: 50, income: true, color: 'var(--good)' },
      { note: 'GrabFood', date: 'Aug 5', amount: 7.5, income: false, color: '#c084f5' },
    ],
  },
]);

// Index into `banks` -- which one Home's carousel currently shows and
// Settings' stack shows fully expanded. Shared so selecting a bank in either
// place moves both.
export const focusedBankIndex = writable(0);

let nextId = 100;

export function addBank(name) {
  banks.update((list) => {
    const color = GOAL_COLORS[list.length % GOAL_COLORS.length];
    list.push({
      bank: { id: 'bank' + nextId++, name, color },
      balance: 0,
      income: 0,
      spending: 0,
      transactions: [],
    });
    return list;
  });
  focusedBankIndex.set(get_length() - 1);
}

function get_length() {
  let len = 0;
  banks.subscribe((list) => (len = list.length))();
  return len;
}

export function renameBank(index, name) {
  banks.update((list) => list.map((b, i) => (i === index ? { ...b, bank: { ...b.bank, name } } : b)));
}

export function recolorBank(index, color) {
  banks.update((list) => list.map((b, i) => (i === index ? { ...b, bank: { ...b.bank, color } } : b)));
}

export function deleteBank(index) {
  banks.update((list) => list.filter((_, i) => i !== index));
  focusedBankIndex.update((i) => Math.max(0, i >= index ? i - 1 : i));
}
