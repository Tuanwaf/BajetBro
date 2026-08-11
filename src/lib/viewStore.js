import { writable } from 'svelte/store';

export const currentView = writable('home');

// Lets any screen open the Add sheet, optionally pre-selecting a mode/goal
// (e.g. the Goals page "Add"/"Spend" buttons jump straight into the right flow).
export const addOpen = writable(false);
export const addIntent = writable(null); // { mode: 'addgoal'|'spendgoal', goalId? }
// The FAB's on-screen rect at the moment it was tapped, used to morph the Add
// sheet out of/into it (see AddExpenseSheet.svelte). null for any other entry
// point (Goals' "Add"/"+Add to this goal") -- those fall back to the plain
// slide-up-from-bottom animation.
export const addOriginRect = writable(null);

export function openAdd(intent = null) {
  addIntent.set(intent);
  addOriginRect.set(null);
  addOpen.set(true);
}

// How many sheets are currently open, across the whole app -- a counter
// rather than a boolean so nested sheets (e.g. BankFormSheet opened from
// inside ManageBanksSheet) don't have one's close prematurely clear the
// other's "a sheet is open" signal. Each sheet component increments this
// itself via an $effect keyed on its own `open` prop; see App.svelte for
// where this combines with keyboard-open state to hide the page behind.
export const openSheetCount = writable(0);

// How many .sheet-page screens (see app.css) are currently showing -- these
// share the root document scroll and swap in for a page's own content
// instead of overlaying it, so unlike openSheetCount above they don't need
// keyboard-driven hiding, but the floating tab bar/FAB still needs to know
// to get out of the way, since these aren't one of the 4 main tabs. Same
// counter (not boolean) reasoning as openSheetCount -- nested .sheet-pages
// (Bank Form inside Manage Banks) shouldn't have the inner one closing
// prematurely un-hide the bar while the outer one is still open.
export const sheetPageCount = writable(0);
