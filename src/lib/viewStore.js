import { writable } from 'svelte/store';

export const currentView = writable('home');

// Lets any screen open the Add sheet, optionally pre-selecting a mode/goal
// (e.g. the Goals page "Reserve" button jumps straight into the right flow).
export const addOpen = writable(false);
export const addIntent = writable(null); // { mode: 'addgoal'|'spendgoal'|'spend', goalId? }
// The FAB's on-screen rect at the moment it was tapped, used to morph the Add
// sheet out of/into it (see AddExpenseSheet.svelte). null for any other entry
// point (Goals' "Reserve"/"+Add to this goal", Home's "Feeds your Goals pool"
// link) -- those fall back to the plain slide-up-from-bottom animation.
export const addOriginRect = writable(null);

export function openAdd(intent = null) {
  addIntent.set(intent);
  addOriginRect.set(null);
  addOpen.set(true);
}
