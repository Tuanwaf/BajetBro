# Open bug: keyboard/scroll glitch on Add Expense (FAB) sheet

**Status:** unresolved, actively getting worse. Picking up here.

## Symptom (as reported on real iPhone — does not reproduce in Playwright)

Open the Add Expense sheet (via the FAB), then focus a text field to bring up
the keyboard. You can briefly see the Home page behind the sheet / the sheet's
content scrolls in a way that leaks into the page behind it.

Progression during the last session:
1. Originally: only happened on the **first** keyboard open per app
   load/refresh. Closing and reopening the keyboard made it go away for the
   rest of the session.
2. One clue narrowed it further: it only shows up when the page **behind**
   the sheet is scrollable (e.g. Home). On a short, non-scrollable page
   (e.g. Goals) opening the FAB and keyboard shows no issue — pointed at
   scroll chaining from the sheet's content into the page behind it.
3. By the end of the session it had regressed from "first time only" to
   **"happens every time."** This regression coincided with one specific
   change becoming the only survivor of everything tried (see below) — that
   change is now a suspect, not just an innocent bystander.

## Six approaches tried, all reverted — none fixed it

Current code is back to original on all of these except #1, which is a
confirmed-good change the user made independently:

1. **(kept, not reverted)** Moved the Save button out of a separate
   fixed/sticky footer and into a plain in-flow element inside
   `.add-scroll`, right after the note field (`AddExpenseSheet.svelte`,
   `.save-wrap`). This was the user's own fix for a *different*, already-solved
   problem (footer fighting the keyboard). Confirmed working for that original
   purpose via Playwright.
2. Added a body/document scroll-lock effect in `App.svelte` while the
   add-sheet is open. No confirmed benefit — reverted.
3. Removed `will-change: transform, border-radius, background-color` from
   `.add-sheet`. **Made things worse** — bug went from first-time-only to
   consistent. Reverted; `will-change` is protective here, not causal (a
   persistent GPU layer keeps `position: fixed` more reliably pinned during a
   keyboard event).
4. Removed the double-nested transform: `.add-track` has its own `transform`
   nested inside `.add-sheet`'s `transform`, unlike every other (single-
   transform) sheet like Loan Log. Tried switching `.add-track.step2` to a
   `left` offset after its slide-in transition settles, so only one
   transformed ancestor remains. No fix — reverted.
5. Added `overscroll-behavior: contain` to `.add-scroll`, targeting the
   scroll-chaining theory from clue #2 above. Still reproduced — reverted.
6. (see #2) — grouped for count, both were scroll/lock related.

Current file state confirmed (2026-08-10): `.add-sheet` still has
`will-change: transform, border-radius, background-color`; no
`overscroll-behavior` anywhere; `App.svelte` only has the original
`focusin`/`focusout` tab-bar-hide effect, no scroll-lock.

## Suggested next step (from last session's closing note)

The Save-button-in-flow change (#1) is the *only* change still in place, and
the bug went from intermittent to constant right around when it became the
sole survivor. Before trying anything new:

**Temporarily revert #1** — put the Save button back in its original
`.save-wrap` fixed/sticky-footer structure (pre-session-start state) — and
check whether "always" reverts back to "first-time-only." That isolates
whether moving the button into the scroll flow changed focus/scroll timing
in a way that made the underlying bug more consistent, or whether it's
unrelated and the real cause is still unidentified.

## Constraint to remember

This bug **does not reproduce in Playwright/desktop** — it's real-iPhone-only
(iOS Safari keyboard-viewport behavior). Every hypothesis has to be verified
on the actual device; automated checks can only confirm "nothing else broke,"
not "the bug is fixed."
