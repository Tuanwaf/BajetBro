import { writable, get } from 'svelte/store';
import { currentView } from './viewStore.js';
import { currentMonth } from './stores.js';
import db from './db.js';

export const tourActive = writable(false);
export const tourStepIndex = writable(0);

// kind 'info' -- just explains the target, a Next button advances.
// kind 'navigate' -- highlights something the user must actually tap (a tab,
// the Start button); advances itself once `waitFor()` becomes true, so it's
// learned by doing rather than narrated. Next still works as a fallback.
export const TOUR_STEPS = [
  // ---------------- first-run setup ----------------
  {
    id: 'ob-income',
    view: 'home',
    target: '[data-guide="ob-income"]',
    title: 'Income',
    body: "The total you're starting this month with — salary plus any savings or leftover you already have. Not sure? Leave it blank and it'll match your salary.",
  },
  {
    id: 'ob-salary',
    view: 'home',
    target: '[data-guide="ob-salary"]',
    title: 'Salary',
    body: 'Your regular monthly pay. You can change this later in Settings whenever it changes — Income adjusts to match automatically.',
  },
  {
    id: 'ob-name',
    view: 'home',
    target: '[data-guide="ob-name"]',
    title: 'Your name',
    body: "Just for the greeting on this page. Totally optional, and you can set or change it in Settings anytime.",
  },
  {
    id: 'ob-start',
    view: 'home',
    target: '[data-guide="ob-start"]',
    kind: 'navigate',
    waitFor: () => !!get(currentMonth),
    title: 'Start your month',
    body: 'Tap this when the numbers look right — it creates your first month so you can start tracking.',
  },

  // ---------------- home dashboard ----------------
  {
    id: 'home-remaining',
    view: 'home',
    target: '[data-guide="balance-remaining"]',
    title: 'Remaining this month',
    body: "The big number at the top — everything you have left to spend or save this month, after every commitment and expense logged so far.",
  },
  {
    id: 'home-stats',
    view: 'home',
    target: '[data-guide="balance-stats"]',
    title: 'Income, Salary & Spent',
    body: 'Income is your comprehensive total (Salary plus anything rolled over or added mid-month). Salary is just your monthly pay on its own. Spent is everything logged this month across every category.',
  },
  {
    id: 'home-loan',
    view: 'home',
    target: '[data-guide="loan-log-card"]',
    title: 'Loan log',
    body: "A manual record of money you've lent to or borrowed from people. It's just for keeping track — it never touches your balance or Spent.",
  },
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
  // The first 4 steps walk through the onboarding fields, which only exist
  // before a month has been created. Replaying the tour later (a month
  // already exists) skips straight to the dashboard steps instead.
  const startIndex = get(currentMonth) ? TOUR_STEPS.findIndex((s) => s.id === 'home-remaining') : 0;
  tourStepIndex.set(Math.max(0, startIndex));
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
