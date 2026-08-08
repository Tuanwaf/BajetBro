import { writable, get } from 'svelte/store';
import { currentView } from './viewStore.js';
import db from './db.js';

export const tourActive = writable(false);
export const tourStepIndex = writable(0);

// kind 'info' -- just explains the target, a Next button advances.
// kind 'navigate' -- highlights something the user must actually tap (a tab,
// the Start button); advances itself once `waitFor()` becomes true, so it's
// learned by doing rather than narrated. Next still works as a fallback.
export const TOUR_STEPS = [
  // ---------------- home dashboard ----------------
  {
    id: 'home-remaining',
    view: 'home',
    target: '[data-guide="balance-remaining"]',
    title: 'Your banks',
    body: "Every bank or e-wallet you track shows up here as its own card — swipe to see a different one.",
  },
  {
    id: 'home-stats',
    view: 'home',
    target: '[data-guide="balance-stats"]',
    title: 'Balance, income & spending',
    body: "Each card shows that bank's own balance, plus what's moved in and out of it this month. Tap a bank's transaction list to see the detail.",
  },
  // 'home-loan' step (Loan log) skipped while that section is disabled on
  // Home -- see feature/multi-bank, 2026-08-07. Restore alongside the card.
  {
    id: 'home-commitments',
    view: 'home',
    target: '[data-guide="commitments-section"]',
    title: 'Commitments',
    body: "Your fixed monthly categories — rent, bills, subscriptions, anything you commit to every month. Each row shows what's been spent against what you planned. Tap a row to see or edit its transactions.",
  },
  {
    id: 'home-buffer',
    view: 'home',
    target: '[data-guide="buffer-row"]',
    title: 'Buffer — how it\'s calculated',
    body: "Buffer = Income − your fixed categories' planned amounts. Whatever's left over automatically becomes flexible spending money for anything that doesn't have its own category. You never set Buffer directly — it's always recalculated for you.",
  },
  {
    id: 'home-add',
    view: 'home',
    target: '[data-guide="tab-add"]',
    title: 'Add an expense',
    body: 'This gold button is how you log anything — a category expense, a Buffer spend, adding to a goal, and more. It works from any tab.',
  },

  // ---------------- navigate to settings ----------------
  {
    id: 'nav-settings',
    view: 'home',
    target: '[data-guide="tab-settings"]',
    kind: 'navigate',
    waitFor: () => get(currentView) === 'settings',
    title: "Let's set up your commitments",
    body: 'Tap Settings below to fill in your fixed categories and amounts.',
  },

  // ---------------- settings ----------------
  {
    id: 'settings-salary',
    view: 'settings',
    target: '[data-guide="settings-salary"]',
    title: 'Salary baseline',
    body: 'Change your monthly salary here whenever it changes. Income updates automatically to match, so the rest of your numbers stay consistent.',
  },
  {
    id: 'settings-categories',
    view: 'settings',
    target: '[data-guide="settings-categories"]',
    title: 'Fixed categories',
    body: 'Tap a name to rename it, or the amount to set what you plan to spend. Add or remove categories to match your own commitments — except Saving, which is protected because it feeds your Goals page directly.',
  },
  {
    id: 'settings-buffer',
    view: 'settings',
    target: '[data-guide="settings-buffer"]',
    title: 'Buffer, recalculated',
    body: "This mirrors what you saw on Home: Income minus your fixed categories. As you fill in planned amounts above, this number updates on its own.",
  },
  {
    id: 'settings-buffer-labels',
    view: 'settings',
    target: '[data-guide="settings-buffer-labels"]',
    title: 'Buffer labels',
    body: 'These are the quick-pick tags shown whenever you log a Buffer expense (like "Misc" or "Zakat"). Add, rename, or remove your own — a new one you type while logging an expense shows up here too.',
  },
  {
    id: 'settings-backup',
    view: 'settings',
    target: '[data-guide="settings-backup"]',
    title: 'Backup & transfer',
    body: 'Export everything to a file anytime, and import it to pick up exactly where you left off on another device. Worth doing before reinstalling the app.',
  },

  // ---------------- navigate to goals ----------------
  {
    id: 'nav-goals',
    view: 'settings',
    target: '[data-guide="tab-goals"]',
    kind: 'navigate',
    waitFor: () => get(currentView) === 'goals',
    title: 'Now, your Goals',
    body: 'Tap Goals below to see where your Saving actually goes.',
  },

  // ---------------- goals ----------------
  {
    id: 'goals-pool',
    view: 'goals',
    target: '[data-guide="goals-pool"]',
    title: 'Ready to allocate',
    body: "Every ringgit you log under the Saving category lands here first. Spread it across your goals below, or spend it directly — it's yours until you decide where it goes.",
  },
  {
    id: 'goals-list',
    view: 'goals',
    target: '[data-guide="goals-list"]',
    title: 'Your goals',
    body: 'Create a goal for anything you\'re saving up for. Reserve money into it from your pool, then log spends against it once you actually use that money.',
  },

  // ---------------- navigate to history ----------------
  {
    id: 'nav-history',
    view: 'goals',
    target: '[data-guide="tab-history"]',
    kind: 'navigate',
    waitFor: () => get(currentView) === 'history',
    title: 'Last stop: History',
    body: 'Tap History below to see how your months add up over time.',
  },

  // ---------------- history ----------------
  {
    id: 'history-ring',
    view: 'history',
    target: '[data-guide="history-ring"]',
    title: 'Spending breakdown',
    body: "This ring shows how this month's spending splits across your categories, at a glance.",
  },
  {
    id: 'history-log',
    view: 'history',
    target: '[data-guide="history-log"]',
    title: 'Monthly log',
    body: "Every month you've closed, rolled forward automatically. Tap any month to expand it and see the full breakdown.",
  },
];

export async function startTour() {
  currentView.set('home');
  tourStepIndex.set(0);
  tourActive.set(true);
}

export async function endTour(markComplete = true) {
  tourActive.set(false);
  if (markComplete) await db.meta.put({ key: 'tourCompleted', value: true });
}

export function nextStep() {
  const i = get(tourStepIndex);
  if (i + 1 >= TOUR_STEPS.length) {
    endTour(true);
  } else {
    tourStepIndex.set(i + 1);
  }
}

export function backStep() {
  const i = get(tourStepIndex);
  if (i > 0) tourStepIndex.set(i - 1);
}
