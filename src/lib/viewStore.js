import { writable } from 'svelte/store';

export const currentView = writable('home');

// Lets any screen open the Add sheet, optionally pre-selecting a mode/goal
// (e.g. the Goals page "Reserve" button jumps straight into the right flow).
export const addOpen = writable(false);
export const addIntent = writable(null); // { mode: 'addgoal'|'spendgoal'|'spend', goalId? }

export function openAdd(intent = null) {
  addIntent.set(intent);
  addOpen.set(true);
}
