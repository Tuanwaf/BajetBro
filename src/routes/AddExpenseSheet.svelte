<script>
  import { get } from 'svelte/store';
  import { currentMonth, template, goals } from '../lib/stores.js';
  import { goalAllocated, goalReserveLeft, goalReserveByBank, goalReached, spendRM, round2 } from '../lib/calc.js';
  import { fmt, formatDate, cycleDatetimeBounds } from '../lib/format.js';
  import DateTimeField from '../lib/components/DateTimeField.svelte';
  import { showToast } from '../lib/toast.js';
  import { BUFFER_COLOR, BUFFER_LABEL_PRESETS } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { currentView, openSheetCount } from '../lib/viewStore.js';
  import { banks as bankPreviewStore, focusedBankIndex, adjustBankBalance, computeBankReserved, reconcileGoalReserve } from '../lib/bankPreviewStore.js';
  import BankIcon from '../lib/components/BankIcon.svelte';
  import { loadNoteHistory, suggestNotes } from '../lib/noteHistory.js';
  import { recordStreakActivity } from '../lib/streak.js';

  let { open, onClose, intent = null, originRect = null } = $props();

  $effect(() => {
    if (!open) return;
    openSheetCount.update((n) => n + 1);
    return () => openSheetCount.update((n) => n - 1);
  });

  // iOS-style "grow from the FAB, shrink back into it" morph. `openClass` (not
  // the `open` prop directly) drives the sheet's own open/closed CSS class --
  // on open it's set immediately (grow animation plays over the top of the
  // already-open baseline); on close it's deliberately held at `true` until
  // the shrink animation finishes, so the sheet stays visually "settled open"
  // underneath the WAAPI-driven shrink the whole time, instead of the CSS
  // slide-down transition fighting it. Falls back to the plain instant toggle
  // (today's slide-up/down behaviour) whenever there's no origin rect --
  // Goals' "Reserve"/"+ Add to this goal" and Home's "Feeds your Goals pool"
  // link open this sheet without a FAB to morph from.
  let sheetEl = $state(null);
  let trackEl = $state(null);
  let ghostEl = $state(null);
  let openClass = $state(false);
  let activeOriginRect = null;
  let activeAnims = [];

  const GROW_MS = 340;
  // Ease-IN-out, not the fast-start curve shrink still uses below -- growing
  // fast-start meant most of the size change happened in the very first
  // slice of the animation, so on a real device (slower/jankier frame
  // pacing than desktop Chromium) the very first frame a person actually
  // perceives was already well past the small-circle stage. Slow-start
  // keeps it visibly small for longer before it accelerates into full size.
  const GROW_EASE = 'cubic-bezier(0.65, 0, 0.35, 1)';
  const SHRINK_MS = 450;
  const SHRINK_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';
  // Matches .navfab:active's own press scale exactly -- the ask was for the
  // landing to feel like the SAME button-press-and-release the FAB already
  // has when tapped, not an arbitrary bounce value. Applied as a uniform
  // multiplier on BOTH scaleX and scaleY (see the explicit bounce keyframes
  // in shrinkToRect below), not via a bezier overshoot on the raw scale
  // values -- those overshoot in absolute terms, and since the FAB's ~60px
  // square target comes from scaling down a 390px-wide but 844px-tall
  // viewport, scaleX and scaleY shrink by very different absolute amounts. A
  // shared overshoot curve on the raw values hits height much harder than
  // width (verified via Playwright: 1.56 collapsed height toward near-zero
  // while width barely dipped -- a squished oval, not a bounce). Multiplying
  // the ALREADY-correct target scale by one shared factor keeps scaleX/
  // scaleY proportional to each other throughout the dip regardless of size.
  const BOUNCE_DIP = 0.92;

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  function cancelActiveAnims() {
    activeAnims.forEach((a) => a.cancel());
    activeAnims = [];
  }
  // Leftover inline overrides from a previous close (see the shrink handoff
  // below) are cleared here, at the START of the next open, rather than a
  // fixed delay after closing -- sidesteps ever needing to guess how long the
  // `openClass` class removal takes to actually reach the DOM. It evidently
  // isn't always within one requestAnimationFrame on a real iPhone, which is
  // what caused the "closes twice" bug: clearing the inline overrides on a
  // timer revealed the still-`open` class for a moment, and when that
  // class removal finally landed afterwards, THAT played as a second, fully
  // CSS-transitioned slide-down.
  function clearInlineOverrides() {
    if (!sheetEl) return;
    sheetEl.style.transition = '';
    sheetEl.style.transform = '';
    sheetEl.style.borderRadius = '';
    sheetEl.style.backgroundColor = '';
  }
  // The real FAB is fully hidden behind the (opaque) sheet for the entire
  // transition, so without this there's nothing playing the "+" glyph's part
  // of the crossfade at all -- iOS overlays the launching app's real content
  // with the actual home-screen icon glyph fading out (and the reverse on
  // close), not a hard cut from icon to content. `.fab-ghost` is a sibling of
  // `.add-sheet`, not a descendant -- it has to live outside that element's
  // own scale transform, or it would shrink/grow along with the sheet
  // instead of staying pinned at the FAB's real on-screen size throughout.
  function positionGhost(rect) {
    if (!ghostEl) return;
    ghostEl.style.left = rect.left + 'px';
    ghostEl.style.top = rect.top + 'px';
    ghostEl.style.width = rect.width + 'px';
    ghostEl.style.height = rect.height + 'px';
  }
  function growFromRect(rect) {
    if (!sheetEl || prefersReducedMotion()) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const sx = rect.width / vw, sy = rect.height / vh;
    cancelActiveAnims();
    const transformAnim = sheetEl.animate(
      [
        { transform: `translate(${rect.left}px, ${rect.top}px) scale(${sx}, ${sy})` },
        { transform: 'translate(0px, 0px) scale(1, 1)' },
      ],
      { duration: GROW_MS, easing: GROW_EASE }
    );
    const shapeAnim = sheetEl.animate(
      [
        { borderRadius: '50%', backgroundColor: 'var(--gold)' },
        { borderRadius: '0%', backgroundColor: 'var(--ink)' },
      ],
      { duration: GROW_MS, easing: GROW_EASE }
    );
    activeAnims.push(transformAnim, shapeAnim);
    if (trackEl) {
      // Content starts fading in at 10% and overlaps with the ghost "+"
      // fading out below -- a real crossfade, not a hard cut once the shape's
      // merely "big enough".
      activeAnims.push(
        trackEl.animate(
          [
            { opacity: 0, offset: 0 },
            { opacity: 0, offset: 0.1 },
            { opacity: 1, offset: 0.55 },
            // Explicit hold -- see the ghost animation below for why an
            // implicit final keyframe isn't reliable here.
            { opacity: 1, offset: 1 },
          ],
          { duration: GROW_MS, easing: 'ease-out' }
        )
      );
    }
    if (ghostEl) {
      positionGhost(rect);
      // Fully gone by 25% (was 45%) -- it was still visible once the sheet
      // had nearly finished growing, which shouldn't be possible on paper
      // given these offsets, but evidently was on a real device (this whole
      // feature has repeatedly shown a gap between Chromium timing and real
      // iPhone timing). Front-loading the fade-out this hard leaves a wide
      // safety margin against that gap instead of just nudging the numbers.
      // Scales UP while it fades out (was down -- direction was backwards),
      // not just a flat opacity change: matches how iOS actually scales the
      // icon glyph bigger as it dissolves into the growing app.
      activeAnims.push(
        ghostEl.animate(
          [
            { opacity: 1, transform: 'scale(1)', offset: 0 },
            { opacity: 0, transform: 'scale(1.4)', offset: 0.25 },
            // Explicit hold instead of relying on the implicit final
            // keyframe -- Chromium testing showed the scale actually
            // climbing back toward 1 afterward without this, an artifact of
            // how an implicit-end keyframe interacts with a whole-animation
            // easing rather than the flat hold the spec implies.
            { opacity: 0, transform: 'scale(1.4)', offset: 1 },
          ],
          { duration: GROW_MS, easing: 'ease-in' }
        )
      );
    }
  }
  function shrinkToRect(rect) {
    if (!sheetEl || prefersReducedMotion()) return Promise.resolve();
    const vw = window.innerWidth, vh = window.innerHeight;
    const sx = rect.width / vw, sy = rect.height / vh;
    cancelActiveAnims();
    const landed = `translate(${rect.left}px, ${rect.top}px) scale(${sx}, ${sy})`;
    const dipped = `translate(${rect.left}px, ${rect.top}px) scale(${sx * BOUNCE_DIP}, ${sy * BOUNCE_DIP})`;
    const transformAnim = sheetEl.animate(
      [
        { transform: 'translate(0px, 0px) scale(1, 1)', offset: 0, easing: SHRINK_EASE },
        // Dip-and-release easing matches button { transition: transform 0.1s
        // ease; } app-wide, same as .navfab:active itself -- this is meant
        // to feel like that exact press-and-release, not a distinct effect.
        { transform: landed, offset: 0.82, easing: 'ease' },
        { transform: dipped, offset: 0.91, easing: 'ease' },
        { transform: landed, offset: 1 },
      ],
      { duration: SHRINK_MS, fill: 'forwards' }
    );
    const shapeAnim = sheetEl.animate(
      [
        { borderRadius: '0%', backgroundColor: 'var(--ink)' },
        { borderRadius: '50%', backgroundColor: 'var(--gold)' },
      ],
      { duration: SHRINK_MS, easing: SHRINK_EASE, fill: 'forwards' }
    );
    if (trackEl) {
      // Unchanged from before -- this timing (content visible until 40%
      // elapsed, which given the deceleration curve is still a fairly large
      // shape) is what already read as smooth per feedback.
      activeAnims.push(
        trackEl.animate(
          [
            { opacity: 1, offset: 0 },
            { opacity: 0, offset: 0.4 },
            { opacity: 0, offset: 1 },
          ],
          { duration: SHRINK_MS, easing: 'ease-in' }
        )
      );
    }
    if (ghostEl) {
      positionGhost(rect);
      // Shifted later than the first version (was 0.35-0.85) per feedback
      // that close already felt right and the "+" should reappear even
      // closer to the very end, once the shape's genuinely small again --
      // fill:'forwards' holds it at opacity 1 until the close handoff
      // cancels it in the same synchronous block as the real FAB's reveal,
      // so the swap is invisible (both look identical, same position/size/
      // color).
      // Mirrors growFromRect's ghost: shrinks from big (1.4 -> 1) while it
      // fades in, rather than a flat opacity change -- same iOS-style scale
      // treatment as the icon glyph, reversed for materializing instead of
      // dissolving.
      activeAnims.push(
        ghostEl.animate(
          [
            { opacity: 0, transform: 'scale(1.4)', offset: 0 },
            { opacity: 0, transform: 'scale(1.4)', offset: 0.55 },
            { opacity: 1, transform: 'scale(1)', offset: 0.95 },
            { opacity: 1, transform: 'scale(1)', offset: 1 },
          ],
          { duration: SHRINK_MS, easing: 'ease-out', fill: 'forwards' }
        )
      );
    }
    activeAnims.push(transformAnim, shapeAnim);
    // Cancelled (superseded by a newer open/close) resolves same as finished
    // -- either way the caller just wants to know it's done reacting to it.
    return Promise.all([transformAnim.finished, shapeAnim.finished]).catch(() => {});
  }

  $effect(() => {
    if (open) {
      clearInlineOverrides();
      activeOriginRect = originRect;
      openClass = true;
      if (activeOriginRect) growFromRect(activeOriginRect);
    } else if (openClass) {
      const rect = activeOriginRect;
      if (!rect) {
        openClass = false;
      } else {
        shrinkToRect(rect).then(() => {
          // Cancel the WAAPI animations FIRST -- active Animations (even
          // held via fill:'forwards') take precedence over inline style in
          // the CSS cascade, so setting inline style before cancelling
          // wouldn't visually do anything yet. Once cancelled, pin the exact
          // resting "closed" look directly via inline style in the very next
          // line, synchronously -- no paint happens between these two
          // statements, so there's no frame where the browser could render
          // an in-between value.
          cancelActiveAnims();
          if (sheetEl) {
            sheetEl.style.transition = 'none';
            sheetEl.style.transform = 'translateY(100%)';
            sheetEl.style.borderRadius = '';
            sheetEl.style.backgroundColor = '';
          }
          // openClass flips here too, but its class removal reaching the DOM
          // is NOT what makes the sheet look closed -- the inline styles
          // above already pin that, and are deliberately left in place
          // (cleared only at the start of the next open, above) instead of
          // being cleared on a timer. Clearing them a fixed delay later is
          // what caused the "closes twice" bug: on a real iPhone the class
          // removal can take longer than one requestAnimationFrame to reach
          // the DOM, so clearing the inline overrides on schedule revealed
          // the still-`open` class for a moment, and when that removal
          // finally landed afterwards, it played as a second, fully
          // CSS-transitioned slide-down.
          openClass = false;
        });
      }
    }
  });

  let month = $derived($currentMonth);
  let tmpl = $derived($template);
  let goalList = $derived(($goals ?? []).filter((g) => !g.closed));
  // Editable from Settings -> Buffer labels; falls back to the built-in
  // defaults for templates created before that field existed.
  let bufferLabels = $derived(tmpl?.bufferLabels ?? BUFFER_LABEL_PRESETS);
  let banksList = $derived($bankPreviewStore);

  // 'expense' (default) is everything that already existed -- fixed
  // categories, Buffer, goals, "paid back to me". 'income' is new money
  // entering this cycle (freelance, gift, refund) -- it replaces Settings'
  // old standalone "Additional income" card. 'transfer' moves your own
  // money between two of your own banks -- not spending, not income, just
  // relocating (see bankPreviewStore.js's computeBankActivity, which
  // deliberately excludes transfers from the spending/income stats).
  let addMode = $state('expense');

  // 'addgoal' = put money into a goal, 'spendgoal' = itemized spend out of
  // a goal's own reserve.
  let selectedCatKey = $state(null);
  // Category is a dropdown, not a chip-grid -- it was the single biggest
  // contributor to this screen's height (every fixed category plus the 4
  // special entries, wrapping across several rows), and a shorter screen is
  // less likely to actually need scrolling, which is the precondition for
  // the keyboard/scroll freeze bug (see FAB_KEYBOARD_SCROLL_BUG.md). The
  // open list is position:absolute within a position:relative wrapper, so
  // it overlays whatever's below instead of pushing it down -- closed, it's
  // not there at all, so it costs nothing when collapsed either.
  let categoryDropdownOpen = $state(false);
  let categoryOptions = $derived([
    ...(tmpl?.categories ?? []).map((c) => ({ key: c.key, name: c.name, color: c.color })),
    { key: 'buffer', name: 'Buffer', color: BUFFER_COLOR },
    { key: 'addgoal', name: 'Add to a goal', color: '#b07af2' },
    { key: 'spendgoal', name: 'Spend on a goal', color: '#3ddcb0' },
    { key: 'reimburse', name: 'Paid back to me', color: 'var(--good)' },
  ]);
  let selectedCategoryOption = $derived(categoryOptions.find((o) => o.key === selectedCatKey) ?? null);
  let selectedBufferLabel = $state(null);
  let customBufferLabel = $state('');
  let selectedGoalId = $state(null);
  let selectedBankId = $state(null);
  // Transfer's destination, or addgoal's "hold it in a different bank"
  // destination -- see heldInChoice below.
  let secondBankId = $state(null);
  // Where an "Add to a goal" contribution actually ends up: 'same' (default
  // -- it just stays in whichever bank it came from, earmarked in place),
  // 'other' (physically moved into a different bank, picked via
  // secondBankId, in this same single action), or 'given' (money leaves for
  // good -- given away, nothing left to reserve or spend later).
  let heldInChoice = $state('same');
  let addCcy = $state('RM');
  let kpCents = $state(0);
  let noteValue = $state('');

  // Remembered notes -- most entries repeat the same few places per
  // category, so the note field offers what was typed before in whichever
  // category/mode is currently picked (see lib/noteHistory.js). Loaded fresh
  // on each open, so entries saved or edited elsewhere are picked up.
  let noteHistory = $state({});
  let noteScope = $derived.by(() => {
    if (addMode === 'income') return 'income';
    if (addMode === 'transfer') return 'transfer';
    if (!selectedCatKey) return null;
    if (selectedCatKey === 'buffer' || selectedCatKey === 'reimburse') return selectedCatKey;
    if (selectedCatKey === 'spendgoal') return selectedGoalId ? `goal:${selectedGoalId}` : null;
    if (selectedCatKey === 'addgoal') return selectedGoalId ? `alloc:${selectedGoalId}` : null;
    return `cat:${selectedCatKey}`;
  });
  // Google-style: the list drops down under the field only while it's
  // focused, and narrows as you type.
  let noteFocused = $state(false);
  let noteInputEl = $state(null);
  let noteSuggestions = $derived(noteFocused ? suggestNotes(noteHistory, noteScope, noteValue, 5) : []);

  function onNoteFocus() {
    noteFocused = true;
    // The field sits near the bottom of the sheet, so on a phone the
    // keyboard covers anything under it -- scroll it up to the top of
    // .add-scroll once the keyboard has had time to come up, leaving the
    // list visible between the field and the keyboard.
    setTimeout(() => {
      if (noteFocused) noteInputEl?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }, 300);
  }
  function pickNote(text) {
    noteValue = text;
    noteFocused = false;
    // Picked = done typing; drop the keyboard so Save is right there.
    noteInputEl?.blur();
  }
  // Splits a suggestion into the part already typed and the rest, so the
  // rest can be bolded like Google does. Only for prefix matches -- a
  // mid-word match is shown plain.
  function splitTyped(text) {
    const q = noteValue.trim();
    if (q && text.toLowerCase().startsWith(q.toLowerCase())) return [text.slice(0, q.length), text.slice(q.length)];
    return ['', text];
  }

  // When this entry actually happened -- defaults to right now, but
  // adjustable back to any point in the CURRENT cycle. Bounded by
  // month.startedAt (the cycle's real start, which can be in the previous
  // calendar month -- see EndMonthSheet's comment on why cycles don't align
  // to calendar boundaries) through the actual moment Save is pressed, not
  // the moment this sheet was opened.
  // A single real <input type="datetime-local"> so one tap edits both date
  // and time together, but it's never actually visible -- it's an
  // opacity:0 layer stretched over a plain styled display (see the markup),
  // clipped by the wrapper's overflow:hidden. Rendering it directly (styled
  // via .note-input, tried first) clipped off the sheet's right edge
  // on-device: the combined control's native segmented layout has an
  // intrinsic width iOS won't shrink below, wider than this sheet has room
  // for. Invisible, that native sizing quirk no longer has anything to
  // visibly clip -- only the decorative text needs to fit, and that's
  // plain flex content we fully control.
  let txDateInput = $state('');
  let minDT = $state('');
  let maxDT = $state('');

  const MAX_CENTS = 99999999;
  let kpDisplay = $derived((kpCents / 100).toFixed(2));
  let step = $state(1); // 1 = amount, 2 = category + note

  let selectedGoal = $derived(goalList.find((g) => g.id === selectedGoalId) || null);
  // Goals eligible for a "spend on a goal" entry: any goal that actually
  // still has reserve left, regardless of how that reserve came to be.
  let spendGoals = $derived(goalList.filter((g) => goalReserveLeft(g) > 0.005));
  let amtCur = $derived(selectedCatKey === 'spendgoal' && selectedGoal?.currency ? addCcy : 'RM');

  // Which bank(s) actually hold this goal's reserve -- spending has to come
  // from one of these, never an arbitrary bank (picking the wrong one would
  // debit a bank that never held the money, while the goal's own numbers
  // stayed the same either way). Empty means old, pre-bank-tagging reserve
  // that can't be attributed -- only then does the picker fall back to the
  // full bank list, since there's nothing better to restrict it to.
  let spendGoalBanks = $derived(selectedCatKey === 'spendgoal' && selectedGoal ? goalReserveByBank(selectedGoal) : []);
  let spendGoalBankOptions = $derived(
    spendGoalBanks.length ? banksList.filter((b) => spendGoalBanks.some((x) => x.bankId === b.bank.id)) : banksList
  );

  // Banks selectable as a transfer's/goal-hold's "second" destination --
  // excludes whichever bank is already picked as the source, since picking
  // the same one there would be a no-op that's just confusing to offer.
  let otherBanksList = $derived(banksList.filter((b) => b.bank.id !== selectedBankId));

  // A plain expense/buffer entry has no idea a bank has money earmarked for
  // a goal -- it'll happily debit straight through it. Rather than block
  // that (sometimes you really do need to dip in), save() warns once per
  // distinct (bank, amount) combo and waits for a second tap before it
  // actually goes through. Keyed by signature rather than a plain boolean
  // so changing the amount or bank after seeing the warning re-checks fresh
  // instead of silently reusing a stale confirmation.
  //
  // Two different things can make a bank's real balance not all be free to
  // spend: money earmarked for a goal (soft, reversible -- see
  // reconcileGoalReserve, which independently re-derives exactly how much of
  // THAT to pull back whenever this entry is later edited/deleted) and a
  // fixed deposit (a static, non-reversible number set on the bank itself --
  // nothing to give back later, since it never actually gets "consumed").
  // Both count toward the same protection threshold here, worded separately
  // so the warning says which one(s) are actually in play.
  let overspendMsg = $state('');
  let overspendPendingSig = '';
  let overspendConfirmedFor = '';
  function checkReserveOverspend(bankId, amt, goals) {
    if (!bankId) return { ok: true };
    const sig = `${bankId}:${amt}`;
    const bank = banksList.find((b) => b.bank.id === bankId);
    if (!bank) return { ok: true };
    const reserved = computeBankReserved(goals, bankId);
    const fixedDeposit = bank.fixedDeposit || 0;
    const protectedAmt = round2(reserved + fixedDeposit);
    if (protectedAmt <= 0.005) return { ok: true };
    const balanceAfter = round2(bank.balance - amt);
    if (balanceAfter >= protectedAmt - 0.005) return { ok: true };
    if (overspendConfirmedFor === sig) return { ok: true };
    const eaten = round2(Math.min(protectedAmt, protectedAmt - balanceAfter));
    const parts = [];
    if (reserved > 0.005) parts.push(`RM ${fmt(reserved)} reserved for your goals`);
    if (fixedDeposit > 0.005) parts.push(`RM ${fmt(fixedDeposit)} locked as a fixed deposit`);
    overspendMsg = `This leaves RM ${fmt(balanceAfter)} in ${bank.bank.name}, but ${parts.join(' and ')} there — RM ${fmt(eaten)} of it would be spent.`;
    overspendPendingSig = sig;
    return { ok: false };
  }
  function confirmOverspend() {
    overspendConfirmedFor = overspendPendingSig;
    overspendMsg = '';
    save();
  }
  // The actual consumption (and its later reversal on edit/delete) lives in
  // bankPreviewStore.js's reconcileGoalReserve -- shared with CategoryDetail/
  // BufferDetailSheet and BankTransactionsSheet's edit/delete, all of which
  // can dip into or give back the same reserve later. `eaten` above is only
  // this warning's own preview number; reconcileGoalReserve re-derives the
  // real amount independently once the debit has actually landed.

  function reset() {
    addMode = 'expense';
    selectedCatKey = null;
    categoryDropdownOpen = false;
    selectedBufferLabel = null;
    customBufferLabel = '';
    selectedGoalId = null;
    // Defaults to whichever bank card is focused on Home right now -- most
    // entries are through the account you're already looking at, so this
    // saves a re-pick almost every time; still just a starting point, freely
    // changeable via the picker below. Falls back to the main bank (then the
    // first bank) if the focused index is somehow out of range. Read once
    // here (not a reactive subscription) since this only needs "whatever it
    // was the moment this sheet opened" -- swiping the Home carousel while
    // the sheet is already open shouldn't retroactively change the pick.
    const focusedBank = banksList[get(focusedBankIndex)];
    selectedBankId = focusedBank?.bank.id ?? banksList.find((b) => b.bank.isMain)?.bank.id ?? banksList[0]?.bank.id ?? null;
    secondBankId = null;
    heldInChoice = 'same';
    addCcy = 'RM';
    kpCents = 0;
    noteValue = '';
    // month is always the current, still-open cycle here (this sheet only
    // ever adds to it), so there's no "next cycle" to bound against -- max
    // is just "now". No lower bound at all for a month record from before
    // `startedAt` existed -- omitting `min` entirely (DateTimeField treats
    // '' as unset) is a safe degrade, not a bug to guard against further.
    const bounds = cycleDatetimeBounds(month);
    minDT = bounds.min;
    maxDT = bounds.max;
    txDateInput = bounds.max;
    step = 1;
    overspendMsg = '';
    overspendConfirmedFor = '';
  }

  // Only run on an actual false->true open transition, not plain `let` --
  // reset()/applyIntent() read banksList/month/goalList, which are reactive
  // $derived values, so calling them from inside this effect silently makes
  // THEM tracked dependencies of it too (same gotcha save()'s own comment
  // above already documents for the db-write cascade). Gating on a change
  // in `wasOpen` means a re-run caused by one of those stores updating
  // while the sheet just sits open (e.g. focusing the date/time picker
  // seems to trigger one on-device) sees `open === wasOpen` and skips
  // reset() entirely -- the sheet no longer needs to guess which reads are
  // "safe"; it just never lets an unrelated store update fire this again
  // until the sheet actually closes and reopens.
  let wasOpen = false;
  $effect(() => {
    if (open && !wasOpen) {
      reset();
      applyIntent(intent);
      loadNoteHistory()
        .then((h) => (noteHistory = h))
        .catch((e) => console.error('[BajetBro] note history failed:', e));
    }
    wasOpen = open;
  });

  function applyIntent(it) {
    if (!it) return;
    selectCat(it.mode);
    if (it.goalId) {
      const g = goalList.find((x) => x.id === it.goalId);
      if (g) {
        // Inlined rather than calling selectGoal(g): that reads the
        // just-written selectedCatKey back reactively, which -- since this
        // runs inside the $effect below -- makes the effect depend on state
        // it also writes and sends it into an infinite update loop. Using
        // the plain `it.mode` argument instead avoids the read-your-own-write.
        selectedGoalId = g.id;
        addCcy = it.mode === 'spendgoal' && g.currency ? g.currency : 'RM';
        if (it.mode === 'spendgoal') {
          const bankId = defaultSpendBank(g);
          if (bankId) selectedBankId = bankId;
        }
      }
    }
    // Coming from a Goals-page button, the goal/mode is already chosen -- jump
    // straight to picking the amount... no, the amount is step 1, so start there
    // but the category is pre-selected for step 2.
    step = 1;
  }

  function next() {
    if (kpCents > 0) step = 2;
  }
  function back() {
    step = 1;
  }

  function pressKey(k, ev) {
    if (k === '⌫') kpCents = Math.floor(kpCents / 10);
    else if (k === '00') kpCents = Math.min(MAX_CENTS, kpCents * 100);
    else kpCents = Math.min(MAX_CENTS, kpCents * 10 + Number(k));
    flashKey(ev?.currentTarget);
  }

  function flashKey(el) {
    if (!el || typeof el.animate !== 'function') return;
    el.__flash?.cancel();
    const cs = getComputedStyle(el);
    const root = getComputedStyle(document.documentElement);
    const rest = { backgroundColor: cs.backgroundColor, borderColor: cs.borderColor, color: cs.color };
    // Read the accent + its border/ink from the live theme tokens rather than
    // hardcoding hex -- this flash used to freeze whatever --gold was at the
    // time it was written, which would've gone stale the moment the palette
    // changed.
    const lit = {
      backgroundColor: root.getPropertyValue('--gold').trim(),
      borderColor: root.getPropertyValue('--stroke-2').trim(),
      color: root.getPropertyValue('--accent-ink').trim(),
    };
    el.__flash = el.animate(
      [
        { ...lit, transform: 'scale(0.95)', offset: 0 },
        { ...lit, transform: 'scale(0.97)', offset: 0.18 },
        { ...rest, transform: 'scale(1)', offset: 1 },
      ],
      { duration: 340, easing: 'cubic-bezier(0.33, 1, 0.68, 1)' }
    );
  }

  // Spending on a goal must come from wherever its reserve actually sits --
  // prefer the most recently held-in bank among those that still have some
  // left; the picker only offers a real choice when the reserve is split
  // across more than one bank. Shared by selectGoal() and applyIntent() --
  // the latter can't just call selectGoal() (see its own comment).
  function defaultSpendBank(g) {
    const byBank = goalReserveByBank(g);
    if (!byBank.length) return null;
    const lastHeldIn = [...(g.allocations || [])]
      .reverse()
      .find((a) => a.heldInBankId && byBank.some((x) => x.bankId === a.heldInBankId))?.heldInBankId;
    return lastHeldIn ?? byBank[0].bankId;
  }

  function selectCat(key) {
    selectedCatKey = key;
    selectedBufferLabel = null;
    customBufferLabel = '';
    selectedGoalId = null;
    secondBankId = null;
    heldInChoice = 'same';
    addCcy = 'RM';
  }

  function selectGoal(g) {
    selectedGoalId = g.id;
    // Default a foreign-currency goal to its own currency (most trip spends
    // are local); flip to RM for ringgit-priced things like a flight.
    addCcy = selectedCatKey === 'spendgoal' && g.currency ? g.currency : 'RM';
    if (selectedCatKey === 'spendgoal') {
      const bankId = defaultSpendBank(g);
      if (bankId) selectedBankId = bankId;
    }
  }

  async function save() {
    const amt = kpCents / 100;
    if (!amt) {
      showToast('Enter an amount first');
      return;
    }
    // Snapshot every reactive field this function needs into plain locals
    // BEFORE any `await` below -- re-reading the $state vars themselves
    // after an await is not safe here. This sheet's own open-effect calls
    // reset()/applyIntent(), which read banksList/goalList; the very
    // db.months/db.goals writes below cascade back through those derived
    // stores (bankPreviewStore.js's merged `banks` depends on currentMonth,
    // goalList depends on the goals table), re-triggering that effect mid-
    // save and resetting these fields back to their defaults -- e.g. a
    // category expense tagged to a second bank was silently being debited
    // from the MAIN bank instead, because by the time adjustBankBalance ran,
    // reset() had already zeroed selectedBankId back to it.
    const mode = addMode;
    const catKey = selectedCatKey;
    const bankId = selectedBankId;
    const secondBank = secondBankId;
    const heldIn = heldInChoice;
    const note = noteValue.trim();

    const chosen = new Date(txDateInput);
    if (isNaN(chosen)) return showToast('Pick a valid date and time');
    if (chosen > new Date()) return showToast("Date can't be in the future");
    if (month.startedAt && chosen < new Date(month.startedAt)) {
      return showToast(`Date can't be before ${formatDate(month.startedAt)} — that's when this cycle started`);
    }
    const entryDate = chosen.toISOString();

    const bufferLabelChoice = selectedBufferLabel;
    const bufferLabelCustom = customBufferLabel.trim();
    const goals = goalList;
    const goal = goals.find((g) => g.id === selectedGoalId) || null;
    const ccy = addCcy;

    if (mode === 'transfer') {
      if (!bankId || !secondBank || bankId === secondBank) return showToast('Pick two different banks first');
      const transfers = [...(month.transfers || []), { date: entryDate, amount: amt, fromBankId: bankId, toBankId: secondBank, note: note || undefined }];
      await db.months.update(month.key, { transfers });
      await adjustBankBalance(bankId, -amt);
      await adjustBankBalance(secondBank, amt);
      const toBankName = banksList.find((b) => b.bank.id === secondBank)?.bank.name ?? '';
      showToast(`Moved RM ${fmt(amt)} to ${toBankName}`);
      recordStreakActivity();
      onClose();
      currentView.set('home');
      return;
    }

    if (mode === 'income') {
      if (!bankId) return showToast('Pick a bank first');
      // Same shape Settings' old "Additional income" card used -- a fresh
      // install with a pre-existing plain total (from before this per-entry
      // log existed) gets that folded in as one synthetic legacy entry, so
      // nothing gets silently double-counted or dropped.
      const baseLog = month.additionalIncomeLog?.length
        ? month.additionalIncomeLog
        : month.additionalIncome > 0
          ? [{ date: month.startedAt || null, amount: month.additionalIncome, legacy: true }]
          : [];
      const log = [...baseLog, { date: entryDate, amount: amt, note: note || undefined, bankId }];
      const total = round2(log.reduce((s, e) => s + (e.amount || 0), 0));
      await db.months.update(month.key, { additionalIncomeLog: log, additionalIncome: total });
      await adjustBankBalance(bankId, amt);
      showToast(`Saved RM ${fmt(amt)} · Income`);
      recordStreakActivity();
      onClose();
      currentView.set('home');
      return;
    }

    if (!catKey) {
      showToast('Pick a category first');
      return;
    }

    if (catKey === 'buffer') {
      const overspend = checkReserveOverspend(bankId, amt, goals);
      if (!overspend.ok) return;
      const label = bufferLabelChoice === 'custom' ? bufferLabelCustom || 'Misc' : bufferLabelChoice || 'Misc';
      const newExtra = { name: label, actual: amt, date: entryDate, note: note || undefined, bankId: bankId || undefined };
      let extras = [...(month.extras || []), newExtra];
      await db.months.update(month.key, { extras });
      if (bankId) await adjustBankBalance(bankId, -amt);
      if (bankId) {
        const consumption = await reconcileGoalReserve(bankId, []);
        if (consumption.length) {
          extras = extras.map((e) => (e === newExtra ? { ...e, reserveConsumption: consumption } : e));
          await db.months.update(month.key, { extras });
        }
      }
      // A new custom label becomes a permanent quick-pick chip (and shows up
      // in Settings), same as if it had been added there directly.
      if (bufferLabelChoice === 'custom' && label && !bufferLabels.includes(label)) {
        await db.template.put({ ...tmpl, bufferLabels: [...bufferLabels, label] });
      }
      showToast(`Saved RM ${fmt(amt)} · Buffer / ${label}`);
      recordStreakActivity();
      onClose();
      currentView.set('home');
      return;
    }

    if (catKey === 'addgoal') {
      if (!goal) return showToast('Pick a goal first');
      if (!bankId) return showToast('Pick a bank first');
      // heldIn === 'given': money leaves for good, nothing reserved.
      // heldIn === 'same': stays exactly where it already was -- earmarked
      // in place, no bank actually debited (see below).
      // heldIn === 'other': physically moved into secondBank, reserved there.
      const heldInBankId = heldIn === 'given' ? null : heldIn === 'other' ? secondBank : bankId;
      if (heldIn === 'other' && !secondBank) return showToast('Pick which bank to hold it in');
      const room = Math.max(0, goal.target - goalAllocated(goal));
      const applied = Math.min(amt, room);
      if (applied <= 0) return showToast('This goal is already at its target');
      // heldInBankId is always null/bankId/secondBank here, never undefined
      // -- storing it as-is (not `?? undefined`, which silently turned a
      // real "given away" `null` into a dropped key once exported/reimported
      // as JSON) keeps it an explicit null, matching what allocIsReserved's
      // own `'heldInBankId' in a` check expects a "given away" allocation to
      // look like.
      const allocations = [...(goal.allocations || []), { date: entryDate, cycleMonth: month.key, amount: applied, fromBankId: bankId, heldInBankId, note: note || undefined }];
      await db.goals.update(goal.id, { allocations });
      // heldInBankId === bankId ("same"): the debit and credit would be the
      // exact same bank canceling out, so skip both writes entirely --
      // nothing actually moved, it's purely a label on money already there.
      if (heldInBankId == null) {
        await adjustBankBalance(bankId, -applied);
      } else if (heldInBankId !== bankId) {
        await adjustBankBalance(bankId, -applied);
        await adjustBankBalance(heldInBankId, applied);
      }
      const verb = heldInBankId == null ? 'Given to' : 'Reserved for';
      showToast(`${verb} ${goal.label} · RM ${fmt(applied)}${applied < amt ? ' (capped to target)' : ''}`);
      recordStreakActivity();
      onClose();
      currentView.set('goals');
      return;
    }

    if (catKey === 'spendgoal') {
      if (!goal) return showToast('Pick a goal first');
      if (!bankId) return showToast('Pick a bank first');
      // Spends are always logged in the goal's own currency (ccy), but a
      // bank's balance -- and the goal's own reserve -- are always RM,
      // so compare/debit in RM regardless of what currency was typed.
      const spendInRM = spendRM(goal, { amount: amt, ccy });
      const left = goalReserveLeft(goal);
      if (spendInRM > left + 0.005) return showToast(`Only RM ${fmt(left)} is reserved for ${goal.label}`);
      const spends = [...(goal.spends || []), { date: entryDate, cycleMonth: month.key, label: note || 'Spend', amount: amt, ccy, bankId }];
      await db.goals.update(goal.id, { spends });
      await adjustBankBalance(bankId, -spendInRM);
      showToast(`Spent ${ccy} ${fmt(amt)} · ${goal.label}`);
      recordStreakActivity();
      onClose();
      currentView.set('goals');
      return;
    }

    if (catKey === 'reimburse') {
      const reimbursements = [...(month.reimbursements || []), { amount: amt, date: entryDate, note: note || undefined, bankId: bankId || undefined }];
      await db.months.update(month.key, { reimbursements });
      if (bankId) await adjustBankBalance(bankId, amt);
      showToast(`Paid back to you · RM ${fmt(amt)}`);
      recordStreakActivity();
      onClose();
      currentView.set('home');
      return;
    }

    // A fixed category expense.
    const overspend = checkReserveOverspend(bankId, amt, goals);
    if (!overspend.ok) return;
    const newTx = { amount: amt, date: entryDate, note: note || undefined, bankId: bankId || undefined };
    let categories = month.categories.map((c) =>
      c.key === catKey ? { ...c, actual: c.actual + amt, transactions: [...(c.transactions || []), newTx] } : c
    );
    await db.months.update(month.key, { categories });
    if (bankId) await adjustBankBalance(bankId, -amt);
    if (bankId) {
      const consumption = await reconcileGoalReserve(bankId, []);
      if (consumption.length) {
        categories = categories.map((c) =>
          c.key === catKey ? { ...c, transactions: c.transactions.map((t) => (t === newTx ? { ...t, reserveConsumption: consumption } : t)) } : c
        );
        await db.months.update(month.key, { categories });
      }
    }

    const cat = tmpl.categories.find((c) => c.key === catKey);
    showToast(`Saved RM ${fmt(amt)} · ${cat?.name ?? ''}`);
    recordStreakActivity();
    onClose();
    currentView.set('home');
  }
</script>

<!-- Sibling of .add-sheet, not a child -- see positionGhost/growFromRect/
     shrinkToRect in the script for why. -->
<div class="fab-ghost" bind:this={ghostEl} aria-hidden="true">
  <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
</div>

<div class="sheet add-sheet" class:open={openClass} bind:this={sheetEl}>
  <div class="add-track" class:step2={step === 2} bind:this={trackEl}>

    <!-- STEP 1 · amount -->
    <div class="add-screen">
      <div class="sheet-hd">
        <button class="icon-btn" aria-label="Close" onclick={onClose}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
        <h2>Add entry</h2>
        <span style="width:38px;"></span>
      </div>
      <div class="mode-toggle">
        <div class="mode-thumb" class:income={addMode === 'income'} class:transfer={addMode === 'transfer'}></div>
        <button class="mode-btn" class:selected={addMode === 'expense'} onclick={() => (addMode = 'expense')}>Expense</button>
        <button class="mode-btn income" class:selected={addMode === 'income'} onclick={() => (addMode = 'income')}>Income</button>
        <button class="mode-btn transfer" class:selected={addMode === 'transfer'} onclick={() => (addMode = 'transfer')}>Transfer</button>
      </div>
      <div class="amt-big">
        <div class="cap">How much?</div>
        <div class="val"><span class="cur">{amtCur}</span>{kpDisplay}</div>
      </div>
      <div class="kp1">
        <div class="keypad">
          {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as k}
            <button class="key" onclick={(e) => pressKey(k, e)}>{k}</button>
          {/each}
          <button class="key op" onclick={(e) => pressKey('⌫', e)} aria-label="Delete">⌫</button>
          <button class="key" onclick={(e) => pressKey('0', e)}>0</button>
          <button class="key next" disabled={kpCents === 0} onclick={next} aria-label="Next">
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l5 5L19 6.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      </div>
    </div>

    <!-- STEP 2 · category + note -->
    <div class="add-screen">
      <div class="sheet-hd">
        <button class="icon-btn" aria-label="Back" onclick={back}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 1 3 7l6 6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <h2>Add entry</h2>
        <button class="icon-btn" aria-label="Close" onclick={onClose}>
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="amt-sum">
        <span class="cur">{amtCur}</span><span class="v">{kpDisplay}</span>
        <button class="edit-amt" onclick={back}>edit</button>
      </div>
    <div class="add-scroll">
    <div class="field-lbl" style="margin-top:2px;">Date & time</div>
    <DateTimeField bind:value={txDateInput} min={minDT} max={maxDT} />
    {#if minDT}
      <p class="hint">Can't be before {formatDate(month.startedAt)} — that's when this cycle started.</p>
    {/if}

    {#if addMode === 'expense'}
    <!-- Shown before Category (and defaulted from Home's focused card, see
       reset() in the script) rather than only appearing once a category is
       picked -- most entries are through whichever bank you're already
       looking at, so this is chosen or confirmed first, not hunted for
       afterward. Hidden for "Spend on a goal" -- that one has its own
       reserve-filtered picker further down instead, since only certain
       banks actually hold that specific goal's money. -->
    {#if selectedCatKey !== 'spendgoal' && banksList.length}
      <div class="field-lbl" style="margin-top:2px;">{selectedCatKey === 'reimburse' ? 'Credited to' : 'Paid from'}</div>
      <div class="chip-scroll">
        {#each banksList as b (b.bank.id)}
          <button class="chip" class:selected={selectedBankId === b.bank.id} onclick={() => (selectedBankId = b.bank.id)}>
            <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} size={18} />
            {b.bank.name}
          </button>
        {/each}
      </div>
    {/if}

    <div class="field-lbl">Category</div>
    <div class="dropdown-wrap">
      <button class="dropdown-btn" onclick={() => (categoryDropdownOpen = !categoryDropdownOpen)}>
        {#if selectedCategoryOption}
          <span class="dot" style="background:{selectedCategoryOption.color}"></span>
          <span style="flex:1;">{selectedCategoryOption.name}</span>
        {:else}
          <span class="placeholder">Choose a category</span>
        {/if}
        <svg class="chev" class:open={categoryDropdownOpen} width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      {#if categoryDropdownOpen}
        <button class="dropdown-backdrop" aria-label="Close" onclick={() => (categoryDropdownOpen = false)}></button>
        <div class="dropdown-list">
          {#each categoryOptions as opt (opt.key)}
            <button class="dropdown-item" class:selected={selectedCatKey === opt.key} onclick={() => { selectCat(opt.key); categoryDropdownOpen = false; }}>
              <span class="dot" style="background:{opt.color}"></span>{opt.name}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if selectedCatKey === 'reimburse'}
      <p class="hint">Money someone paid you back — credited to <b>this month's</b> Remaining, kept separate from your income. Use this when the payback arrives in a later month than the expense (for a same-month bill split, edit the expense instead).</p>
    {/if}

    {#if selectedCatKey === 'spendgoal'}
      {#if spendGoalBankOptions.length > 1}
        <div class="field-lbl">Spend from</div>
        <div class="chip-scroll">
          {#each spendGoalBankOptions as b (b.bank.id)}
            <button class="chip" class:selected={selectedBankId === b.bank.id} onclick={() => (selectedBankId = b.bank.id)}>
              <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} size={18} />
              {b.bank.name}
            </button>
          {/each}
        </div>
      {:else if spendGoalBankOptions.length === 1}
        {@const only = spendGoalBankOptions[0]}
        <div class="field-lbl">Spend from</div>
        <div class="locked-bank-row">
          <BankIcon logo={only.bank.logo} icon={only.bank.icon} name={only.bank.name} color={only.bank.color} size={18} />
          <span class="name">{only.bank.name}</span>
          <span class="lo">only bank still holding this goal's reserve</span>
        </div>
      {/if}
    {/if}

    {#if selectedCatKey === 'buffer'}
      <div class="field-lbl">Buffer label</div>
      <!-- chip-scroll (one row), not chip-grid -- same compaction as
           "Where does this go?"/"Which goal?" above. -->
      <div class="chip-scroll">
        {#each bufferLabels as label}
          <button class="chip ghost" class:selected={selectedBufferLabel === label} style={selectedBufferLabel === label ? `color:${BUFFER_COLOR}` : ''} onclick={() => (selectedBufferLabel = label)}>{label}</button>
        {/each}
        <button class="chip ghost" class:selected={selectedBufferLabel === 'custom'} style={selectedBufferLabel === 'custom' ? `color:${BUFFER_COLOR}` : ''} onclick={() => (selectedBufferLabel = 'custom')}>+ Custom</button>
      </div>
      {#if selectedBufferLabel === 'custom'}
        <input class="note-input" placeholder="Type your own label…" bind:value={customBufferLabel} />
      {/if}
    {/if}

    {#if selectedCatKey === 'addgoal' || selectedCatKey === 'spendgoal'}
      <div class="field-lbl">{selectedCatKey === 'spendgoal' ? 'Spend from which goal?' : 'Which goal?'}</div>
      <!-- chip-scroll (one row), not chip-grid -- same reasoning as
           "Where does this go?" above: compacts this vertically so the
           addgoal/spendgoal screen is less likely to actually need to
           scroll, which is the precondition for the keyboard freeze bug. -->
      <div class="chip-scroll">
        {#each (selectedCatKey === 'addgoal' ? goalList : spendGoals) as g (g.id)}
          <button class="chip ghost" class:selected={selectedGoalId === g.id} style={selectedGoalId === g.id ? `color:${g.color}` : ''} onclick={() => selectGoal(g)}>
            <span class="dot" style="background:{g.color}"></span>{g.label}
          </button>
        {:else}
          <p class="hint" style="margin:0 0 6px;">
            {selectedCatKey === 'addgoal' ? 'No goals yet — create one on the Goals tab.' : 'No goals with money set aside yet.'}
          </p>
        {/each}
      </div>

      {#if selectedCatKey === 'addgoal' && selectedGoal}
        <div class="field-lbl">Where does this go?</div>
        <!-- chip-scroll (one row), not chip-grid -- this is the tallest
             .add-scroll gets (addgoal + "Move to another bank" adds a
             second chip-scroll row plus explanatory hint text below), and
             the keyboard/scroll freeze bug only shows up when this content
             is actually scrollable. Compacting this one row buys headroom
             without touching .add-sheet's position:fixed architecture. -->
        <div class="chip-scroll">
          <button class="chip ghost" class:selected={heldInChoice === 'same'} style={heldInChoice === 'same' ? 'color:#b07af2' : ''} onclick={() => (heldInChoice = 'same')}>Stays in this bank</button>
          <button class="chip ghost" class:selected={heldInChoice === 'other'} style={heldInChoice === 'other' ? 'color:#b07af2' : ''} onclick={() => (heldInChoice = 'other')}>Move to another bank</button>
          <button class="chip ghost" class:selected={heldInChoice === 'given'} style={heldInChoice === 'given' ? 'color:#b07af2' : ''} onclick={() => (heldInChoice = 'given')}>Given away (not tracked)</button>
        </div>
        {#if heldInChoice === 'other'}
          <div class="chip-scroll">
            {#each otherBanksList as b (b.bank.id)}
              <button class="chip" class:selected={secondBankId === b.bank.id} onclick={() => (secondBankId = b.bank.id)}>
                <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} size={18} />
                {b.bank.name}
              </button>
            {:else}
              <p class="hint" style="margin:0 0 6px;">Add another bank first to move this into it.</p>
            {/each}
          </div>
        {/if}
        <p class="hint">
          {#if heldInChoice === 'given'}Leaves your accounts for good — nothing left to spend or track later.
          {:else if heldInChoice === 'other'}Moves out of the bank above and stays reserved in {otherBanksList.find((b) => b.bank.id === secondBankId)?.bank.name ?? 'the bank you pick'} for {selectedGoal.label}, spendable later.
          {:else}Stays exactly where it is — just earmarked for {selectedGoal.label} so you know it's spoken for. Spendable later.{/if}
        </p>
      {/if}

      {#if selectedCatKey === 'spendgoal' && selectedGoal}
        {#if selectedGoal.currency}
          <div class="field-lbl">Amount currency</div>
          <div class="chip-grid">
            <button class="chip ghost" class:selected={addCcy === 'RM'} style={addCcy === 'RM' ? 'color:#3ddcb0' : ''} onclick={() => (addCcy = 'RM')}>RM</button>
            <button class="chip ghost" class:selected={addCcy === selectedGoal.currency} style={addCcy === selectedGoal.currency ? 'color:#3ddcb0' : ''} onclick={() => (addCcy = selectedGoal.currency)}>{selectedGoal.currency} (RM{fmt(selectedGoal.rate)}/1)</button>
          </div>
        {/if}
        <p class="hint">Comes out of money set aside for {selectedGoal.label} — it won't touch this month's Commitments.</p>
      {/if}
    {/if}
    {:else if addMode === 'income'}
    <p class="hint" style="margin:2px 0 14px;">New money this cycle — freelance, a gift, a refund. Counts toward Income and Buffer, same as a bonus would (unlike "Paid back to me", which only tops up Remaining).</p>
    {#if banksList.length}
      <div class="field-lbl" style="margin-top:0;">Credited to</div>
      <div class="chip-scroll">
        {#each banksList as b (b.bank.id)}
          <button class="chip" class:selected={selectedBankId === b.bank.id} onclick={() => (selectedBankId = b.bank.id)}>
            <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} size={18} />
            {b.bank.name}
          </button>
        {/each}
      </div>
    {/if}
    {:else}
    <p class="hint" style="margin:2px 0 14px;">Move your own money between two of your own banks — not spending, just relocating. Doesn't count toward Income, Spending, or the daily chart.</p>
    {#if banksList.length}
      <div class="field-lbl" style="margin-top:0;">From</div>
      <div class="chip-scroll">
        {#each banksList as b (b.bank.id)}
          <button class="chip" class:selected={selectedBankId === b.bank.id} onclick={() => { selectedBankId = b.bank.id; if (secondBankId === b.bank.id) secondBankId = null; }}>
            <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} size={18} />
            {b.bank.name}
          </button>
        {/each}
      </div>
      <div class="field-lbl">To</div>
      <div class="chip-scroll">
        {#each otherBanksList as b (b.bank.id)}
          <button class="chip" class:selected={secondBankId === b.bank.id} onclick={() => (secondBankId = b.bank.id)}>
            <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} size={18} />
            {b.bank.name}
          </button>
        {:else}
          <p class="hint" style="margin:0 0 6px;">Add another bank first to transfer between them.</p>
        {/each}
      </div>
    {/if}
    {/if}

    <div class="field-lbl">Note (optional)</div>
    <div class="note-wrap">
    <input
      class="note-input"
      class:suggesting={noteSuggestions.length > 0}
      placeholder={addMode === 'income' ? 'e.g. Freelance gig, gift, refund' : 'e.g. Deposit, top-up, refund…'}
      autocomplete="off"
      bind:this={noteInputEl}
      bind:value={noteValue}
      onfocus={onNoteFocus}
      onblur={() => (noteFocused = false)}
      onkeydown={(e) => { if (e.key === 'Escape') noteFocused = false; }}
    />
    <!-- Overlay, like the category dropdown -- floats over Save instead of
         pushing it down. An absolute child still counts toward .add-scroll's
         scrollable area, so it isn't clipped when it reaches past the end.
         Capped at 5 rows with no inner scroller (nested scrollers are the
         pattern behind FAB_KEYBOARD_SCROLL_BUG.md). mousedown is prevented
         so tapping a row doesn't blur the field and close the list before
         the click lands. -->
    {#if noteSuggestions.length}
      <div class="note-suggest">
        {#each noteSuggestions as s (s)}
          {@const [typed, rest] = splitTyped(s)}
          <button class="note-suggest-item" onmousedown={(e) => e.preventDefault()} onclick={() => pickNote(s)}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="2"/></svg>
            <span class="txt">{typed}<b>{rest}</b></span>
          </button>
        {/each}
      </div>
    {/if}
    </div>

    <!-- Plain content inside .add-scroll now, not a separate fixed/sticky
         footer -- no special positioning at all, so there's nothing for
         iOS's keyboard-vs-fixed-position quirk to interact badly with. It
         just scrolls into view like the note field above it. -->
    <div class="save-wrap">
      {#if overspendMsg}
        <div class="overspend-warn">
          <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M12 9v4M12 16.5h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10.3 3.9 2.6 17.5A1.6 1.6 0 0 0 4 20h16a1.6 1.6 0 0 0 1.4-2.5L13.7 3.9a1.6 1.6 0 0 0-2.8 0Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          <span>{overspendMsg}</span>
        </div>
        <div style="display:flex; gap:8px;">
          <button class="io-btn" style="flex:1;" onclick={() => (overspendMsg = '')}>Cancel</button>
          <button class="save-btn" style="flex:1; margin-top:0;" onclick={confirmOverspend}>Save anyway</button>
        </div>
      {:else}
        <button class="save-btn" disabled={addMode === 'income' ? !selectedBankId : addMode === 'transfer' ? (!selectedBankId || !secondBankId) : !selectedCatKey} onclick={save}>Save</button>
      {/if}
    </div>
    </div>
    </div>

  </div>
</div>

<style>
  /* Two screens on a horizontal track: step 1 (amount) slides to step 2
     (category + note). The sheet clips the off-screen half. */
  /* transform-origin: 0 0 makes the FAB-morph's translate+scale math in the
     script section (see growFromRect/shrinkToRect) land exactly on the FAB's
     rect -- with the default centre origin, scaling wouldn't produce the
     same top-left-anchored box a getBoundingClientRect() comparison needs.
     will-change keeps this permanently GPU-composited -- same fix as the nav
     dock's corner-flash bug (TabBar.svelte/app.css .nav-indicator): without
     it, WebKit only promotes the element to a layer reactively once the
     WAAPI animation starts, and that promotion/demotion transition is where
     it can glitch. Reproduced only on a real iPhone, never in desktop
     Chromium -- same signature as that earlier bug.
     (2026-08-10: tried removing this to test against a separate first-
     keyboard-open bug -- made that bug MORE frequent, not less, so
     will-change was mitigating it, not causing it. Put back.) */
  .add-sheet { overflow: hidden; transform-origin: 0 0; will-change: transform, border-radius, background-color; }
  /* Fixed at the FAB's exact rect (set imperatively in JS -- see
     positionGhost) and NOT a descendant of .add-sheet, so its size stays
     pinned at the real FAB's on-screen size throughout, unaffected by the
     sheet's own scale transform. z-index above the sheet so the glyph
     stays legible against whatever color the sheet is mid-crossfade. */
  .fab-ghost {
    position: fixed;
    z-index: 61;
    display: flex; align-items: center; justify-content: center;
    color: var(--accent-ink);
    opacity: 0;
    pointer-events: none;
  }
  .fab-ghost svg { width: 24px; height: 24px; }
  .add-track {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 200%;
    display: flex;
    transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .add-track.step2 { transform: translateX(-50%); }
  .add-screen { width: 50%; display: flex; flex-direction: column; min-height: 0; }

  /* step 1 — Expense/Income segmented toggle, then amount, then the big
     circular iPhone-style keypad filling below. Generous margin/padding
     here specifically -- this screen previously had the toggle sitting
     almost flush against "How much?" below it. */
  .mode-toggle {
    position: relative;
    flex-shrink: 0;
    display: flex; gap: 4px;
    background: var(--panel); border: 2px solid var(--stroke-2); border-radius: 14px;
    padding: 3px;
    margin: 14px 20px 22px;
  }
  /* Slides between the three slots instead of the buttons just swapping
     background color instantly -- translateX is relative to the thumb's
     OWN width, so it lands one slot over regardless of the container's
     exact pixel width. */
  .mode-thumb {
    position: absolute;
    top: 3px; left: 3px;
    width: calc(33.333% - 5px);
    height: calc(100% - 6px);
    border-radius: 11px;
    background: var(--gold);
    transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1), background-color 0.32s;
  }
  .mode-thumb.income {
    transform: translateX(calc(100% + 4px));
    background: var(--good);
  }
  .mode-thumb.transfer {
    transform: translateX(calc(200% + 8px));
    background: #6e8bff;
  }
  .mode-btn {
    position: relative;
    flex: 1; background: none; border: none; border-radius: 11px;
    padding: 8px 0;
    font-size: 13px; font-weight: 700; color: var(--dim);
    transition: color 0.32s;
  }
  .mode-btn.selected { color: var(--accent-ink); }
  .mode-btn.income.selected { color: #fff; }
  .mode-btn.transfer.selected { color: #fff; }
  .amt-big { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; padding: 4px 20px 8px; }
  .amt-big .cap { font-size: 12px; color: var(--lo); font-weight: 600; margin-bottom: 6px; }
  .amt-big .val { font-family: var(--mono); font-size: 46px; font-weight: 600; letter-spacing: -0.02em; }
  .amt-big .val .cur { font-size: 20px; color: var(--lo); vertical-align: 8px; margin-right: 4px; }
  .kp1 { flex: 1; display: flex; align-items: center; justify-content: center; padding: 8px 24px calc(env(safe-area-inset-bottom, 0px) + 24px); }
  .kp1 .keypad { width: 100%; max-width: 330px; margin: 0; gap: 18px 26px; }
  .kp1 .key {
    aspect-ratio: 1;
    border-radius: 50%;
    padding: 0;
    font-size: 27px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .kp1 .key.op { font-size: 22px; }
  .key.next { background: var(--gold); border-color: var(--stroke-2); color: var(--accent-ink); }
  .key.next:disabled { opacity: 0.35; }
  .key.next svg { width: 28px; height: 28px; }

  /* step 2 */
  .amt-sum { flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 2px 0 12px; }
  .amt-sum .cur { font-size: 15px; color: var(--lo); margin-right: 2px; }
  .amt-sum .v { font-family: var(--mono); font-size: 26px; font-weight: 600; }
  .amt-sum .edit-amt { font-size: 11px; color: var(--gold); font-weight: 700; border: 1.5px solid var(--stroke-2); border-radius: 99px; padding: 3px 10px; background: none; margin-left: 6px; }
  .add-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 20px 10px; scrollbar-width: none; }
  .add-scroll::-webkit-scrollbar { display: none; }
  /* Same "one swipeable line, not a wrap-to-multiple-rows grid" treatment
     as BankFormFields.svelte's own bank-logo/design pickers -- there can be
     more banks than comfortably fit on one screen width. */
  .chip-scroll {
    display: flex; gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    margin-bottom: 6px;
    padding: 2px 2px 4px;
  }
  .chip-scroll::-webkit-scrollbar { display: none; }
  .chip-scroll .chip { flex-shrink: 0; }

  /* Google-style suggestion list, visually attached under the note field. */
  .note-input.suggesting { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
  .note-input { scroll-margin-top: 28px; }
  .note-wrap { position: relative; }
  .note-suggest {
    position: absolute;
    z-index: 6;
    top: 100%;
    left: 0; right: 0;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.25);
    display: flex; flex-direction: column;
    background: var(--panel);
    border: 2px solid var(--stroke-2); border-top: 1px solid var(--stroke);
    border-radius: 0 0 14px 14px;
    padding: 4px 0;
  }
  .note-suggest-item {
    display: flex; align-items: center; gap: 10px;
    padding: 11px 14px;
    background: none; border: none;
    font-family: var(--body); font-size: 14px; color: var(--hi);
    text-align: left;
  }
  .note-suggest-item:active { background: var(--panel-2); }
  .note-suggest-item svg { flex-shrink: 0; color: var(--dim); }
  .note-suggest-item .txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .note-suggest-item .txt b { font-weight: 700; }

  /* Category dropdown -- position:relative wrapper + position:absolute list
     means the open list overlays whatever's below (Buffer label, goal
     picker, Note field, Save button) instead of pushing it down the page.
     Closed, .dropdown-list isn't even in the DOM, so it costs nothing. */
  .dropdown-wrap { position: relative; margin-bottom: 6px; }
  .dropdown-btn {
    width: 100%;
    display: flex; align-items: center; gap: 8px;
    padding: 12px 14px;
    background: var(--panel); border: 2px solid var(--stroke-2); border-radius: 14px;
    font-family: var(--body); font-size: 14px; font-weight: 600; color: var(--hi);
    text-align: left;
  }
  .dropdown-btn .placeholder { flex: 1; color: var(--dim); font-weight: 500; }
  .dropdown-btn .chev { flex-shrink: 0; color: var(--dim); transition: transform 0.2s ease; }
  .dropdown-btn .chev.open { transform: rotate(180deg); }
  /* Fixed, full-viewport, and BELOW .dropdown-list's own z-index -- a tap
     anywhere outside the list closes it, same as a native dropdown/select,
     without needing a separate outside-click listener. */
  .dropdown-backdrop { position: fixed; inset: 0; z-index: 5; background: none; border: none; padding: 0; }
  /* No max-height/overflow-y here on purpose -- a nested scroller inside
     this is exactly the pattern behind the keyboard/scroll freeze bug this
     whole redesign is trying to avoid. Long lists just extend the sheet's
     own .add-scroll further; that's a real scroll, not a nested one. */
  .dropdown-list {
    position: absolute;
    z-index: 6;
    top: calc(100% + 6px);
    left: 0; right: 0;
    display: flex; flex-direction: column; gap: 2px;
    padding: 6px;
    background: var(--panel); border: 2px solid var(--stroke-2); border-radius: 14px;
    box-shadow: 4px 4px 0 var(--stroke-2);
  }
  .dropdown-item {
    display: flex; align-items: center; gap: 8px;
    padding: 11px 10px;
    border-radius: 10px;
    background: none; border: none;
    font-family: var(--body); font-size: 13.5px; font-weight: 600; color: var(--hi);
    text-align: left;
  }
  .dropdown-item.selected { background: var(--panel-2); }

  .locked-bank-row {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px; margin-bottom: 6px;
    border: 1.5px solid var(--stroke); border-radius: 12px;
    background: var(--panel-2);
  }
  .locked-bank-row .name { font-size: 13.5px; font-weight: 700; color: var(--hi); }
  .locked-bank-row .lo { font-size: 11.5px; color: var(--dim); }
  /* Plain in-flow block now, not a footer bar -- no horizontal padding of
     its own (add-scroll already provides that), just vertical spacing plus
     a divider line to set it apart from the note field above it. */
  .save-wrap {
    margin-top: 14px;
    padding-top: 14px;
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + 10px);
    border-top: 1px solid var(--stroke);
  }
  .save-btn:disabled { opacity: 0.4; }
  .overspend-warn {
    display: flex; align-items: flex-start; gap: 8px;
    color: var(--gold); font-size: 12.5px; font-weight: 600; line-height: 1.4;
    margin-bottom: 10px;
  }
  .overspend-warn svg { flex-shrink: 0; margin-top: 1px; }
</style>
