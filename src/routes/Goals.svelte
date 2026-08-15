<script>
  import { goals, loans, currentMonth as currentMonthStore } from '../lib/stores.js';
  import { banks as bankPreviewStore, adjustBankBalance, computeBankReserved } from '../lib/bankPreviewStore.js';
  import {
    goalAllocated,
    goalSpent,
    goalReserveLeft,
    goalReserveByBank,
    goalReached,
    spendRM,
    round2,
  } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { openAdd, sheetPageCount } from '../lib/viewStore.js';
  import { swipeBack } from '../lib/swipeBack.js';
  import { GOAL_COLORS } from '../lib/constants.js';
  import db from '../lib/db.js';
  import BankIcon from '../lib/components/BankIcon.svelte';
  import LoanLogSheet from './LoanLogSheet.svelte';

  // Sentinel for "take from goal" sources that were never tied to a real
  // bank -- a goal's starting balance, entered at creation. Never collides
  // with a real bank id (those all look like `bank_<uuid>`).
  const UNTRACKED = 'untracked';

  let goalList = $derived($goals ?? []);
  let banksList = $derived($bankPreviewStore);

  let activeGoals = $derived(goalList.filter((g) => !g.closed));
  let closedGoals = $derived(goalList.filter((g) => g.closed));

  // Always shown now, at the bottom of the page (see markup) -- originally
  // added just for the empty state (a short, non-scrollable page changes
  // how the fixed nav dock's bottom offset settles on a real iPhone, the
  // same "short vs. scrollable" distinction refreshBounce already tracks in
  // App.svelte), but a single 3-stat row wasn't enough height on its own
  // either way, and it's genuinely useful with goals too, so it stays for
  // both cases instead of being an empty-state-only patch.
  let totalContributed = $derived(round2(goalList.reduce((s, g) => s + goalAllocated(g), 0)));
  let totalSpentFromGoals = $derived(round2(goalList.reduce((s, g) => s + goalSpent(g), 0)));

  // The app's own current-cycle month (only advances when you tap through
  // End Month), NOT the real device calendar date -- this app lets you run
  // ahead of or behind the calendar on purpose, so "today" for every other
  // screen (Home, History, ...) means "the open, not-yet-closed month," not
  // whatever the device clock says. Falls back to the real date only in the
  // brief window before onboarding creates the first month (Goals isn't
  // reachable then anyway, but keeps this derivation from ever breaking).
  let currentMonth = $derived(
    $currentMonthStore?.key ??
      (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      })()
  );

  // ---------- goal activity chart (Contribute vs Spend, by month) ----------
  // A two-line trend across every goal (active or closed, same scope as the
  // totals above) -- replaces the old third "Closed" stat, which just
  // duplicated the closed-goals count already shown in the "Closed goals"
  // row above.
  function addMonths(monthKey, delta) {
    let [y, mo] = monthKey.split('-').map(Number);
    mo += delta;
    while (mo > 12) { mo -= 12; y++; }
    while (mo < 1) { mo += 12; y--; }
    return `${y}-${String(mo).padStart(2, '0')}`;
  }

  let goalActivityMaps = $derived.by(() => {
    const contribByMonth = new Map();
    const spendByMonth = new Map();
    for (const g of goalList) {
      for (const a of g.allocations || []) {
        // A `starting` allocation is what the goal already had before it
        // was ever tracked here -- not a contribution that happened in
        // whatever month it's dated/cycleMonth-tagged as. Counting it
        // would show a spike on the chart for a month you didn't actually
        // contribute anything in.
        if (a.starting) continue;
        if (!a.date) continue;
        // Bucket by the cycle month that was OPEN when this was logged, not
        // the real calendar date it happened to land on -- this app's
        // "month" is a user-controlled cycle (advanced via End Month, can
        // run ahead of or behind the real calendar), and every other screen
        // already scopes financial activity by cycle month, not the device
        // clock. Falls back to the real date for entries logged before this
        // field existed -- cycle and calendar track each other closely
        // enough historically that this is a fine approximation for old data.
        const m = a.cycleMonth || a.date.slice(0, 7);
        contribByMonth.set(m, round2((contribByMonth.get(m) || 0) + a.amount));
      }
      for (const s of g.spends || []) {
        if (!s.date) continue;
        const m = s.cycleMonth || s.date.slice(0, 7);
        spendByMonth.set(m, round2((spendByMonth.get(m) || 0) + spendRM(g, s)));
      }
    }
    return { contribByMonth, spendByMonth };
  });

  // A fixed 5-month WINDOW, not a variable-length timeline -- a long goal
  // history used to stretch the chart to fit every month it had ever seen
  // at once, which either squeezed the points down to an unreadable
  // squiggle or forced the whole card to scroll. Paging exactly one month
  // per tap keeps every point a fixed, readable width no matter how much
  // history exists. `chartViewEnd: null` means "live" -- it auto-follows
  // the app's current cycle month (see `currentMonth` above) until the user
  // pages backward with ‹, at which point it pins to a specific month until
  // they page all the way back to the present with › (which snaps back to
  // "live" so future month rollovers keep auto-advancing without another tap).
  let chartViewEnd = $state(null);
  let effectiveEndMonth = $derived(chartViewEnd ?? currentMonth);
  let windowStartMonth = $derived(addMonths(effectiveEndMonth, -4));
  let earliestActivityMonth = $derived.by(() => {
    const keys = [...goalActivityMaps.contribByMonth.keys(), ...goalActivityMaps.spendByMonth.keys()];
    return keys.length ? keys.sort()[0] : null;
  });
  // Can't page back past real activity or the default 5-month floor,
  // whichever is earlier -- no point paging into blank pre-history the user
  // never had.
  let chartFloorMonth = $derived.by(() => {
    const defaultFloor = addMonths(currentMonth, -4);
    return earliestActivityMonth && earliestActivityMonth < defaultFloor ? earliestActivityMonth : defaultFloor;
  });
  let canChartGoBack = $derived(windowStartMonth > chartFloorMonth);
  let canChartGoForward = $derived(effectiveEndMonth < currentMonth);
  function chartGoBack() {
    if (!canChartGoBack) return;
    chartViewEnd = addMonths(effectiveEndMonth, -1);
  }
  function chartGoForward() {
    if (!canChartGoForward) return;
    const next = addMonths(effectiveEndMonth, 1);
    chartViewEnd = next >= currentMonth ? null : next;
  }

  let goalActivityByMonth = $derived.by(() => {
    const { contribByMonth, spendByMonth } = goalActivityMaps;
    const months = [];
    for (let i = 0; i < 5; i++) months.push(addMonths(windowStartMonth, i));
    return months.map((m) => ({
      month: m,
      contribute: contribByMonth.get(m) || 0,
      spend: spendByMonth.get(m) || 0,
    }));
  });

  // Plain hand-rolled SVG line chart -- nothing in this app pulls in a
  // charting library. Two pieces sit side by side (see markup): a small
  // fixed-width axis SVG (the RM figures stay flush against the card's left
  // edge) and the actual plot. The plot SVG uses a fixed virtual coordinate
  // width (PLOT_W) but renders at width="100%" -- the browser stretches the
  // viewBox to whatever the flex container's real width is, so the 5 points
  // always spread evenly across the available space with no JS width
  // measurement needed (this only works because the window is now always
  // exactly 5 months; a variable-length timeline needed the old
  // measure-and-scroll approach instead).
  const AXIS_W = 38;
  const CHART_H = 106;
  const PLOT_W = 260;
  const PLOT_PAD_X = 14;
  const PLOT_PAD_TOP = 16;
  const PLOT_PAD_BOTTOM = 22;
  // Fixed, human-picked reference lines for a brand-new user with no
  // activity yet -- 0/0.5/1 off a chartMax of 1 (the old no-data fallback)
  // rounded to "0"/"1"/"1" on the narrow axis, which looked broken rather
  // than empty. These aren't evenly spaced on purpose: RM amounts a
  // first-time user actually recognizes (50/100/200/500) read better than a
  // mathematically even split of an arbitrary placeholder ceiling.
  const DEFAULT_TICKS = [0, 50, 100, 200, 500];
  let realMax = $derived(Math.max(0, ...goalActivityByMonth.flatMap((d) => [d.contribute, d.spend])));
  let chartMax = $derived(realMax > 0 ? realMax : DEFAULT_TICKS.at(-1));
  // 5 evenly-spaced reference lines (0/quarter/half/three-quarter/max) once
  // there's real data to scale against, so the lines' shape can actually be
  // read as amounts, not just relative up-and-down.
  let chartYTicks = $derived(
    realMax > 0 ? [0, chartMax / 4, chartMax / 2, (chartMax * 3) / 4, chartMax] : DEFAULT_TICKS
  );
  function chartX(i) {
    return PLOT_PAD_X + (i * (PLOT_W - PLOT_PAD_X * 2)) / 4;
  }
  function chartY(v) {
    const innerH = CHART_H - PLOT_PAD_TOP - PLOT_PAD_BOTTOM;
    return PLOT_PAD_TOP + innerH - (v / chartMax) * innerH;
  }
  // Axis gridlines/labels are positioned by ROW INDEX, not by chartY(value) --
  // the real-data ticks (0/quarter/half/three-quarter/max) are evenly spaced
  // in value too so this looks identical either way, but the no-data
  // DEFAULT_TICKS (0/50/100/200/500) deliberately aren't evenly spaced in
  // value, and placing them proportionally crammed 0/50/100 into the bottom
  // 20% of the chart with a big empty gap above. Evenly spacing by index
  // instead keeps every row legible regardless of how the tick values
  // themselves are spaced -- harmless here since an all-zero/no-data chart
  // has no real line to misalign against.
  function tickY(i, n) {
    const innerH = CHART_H - PLOT_PAD_TOP - PLOT_PAD_BOTTOM;
    return PLOT_PAD_TOP + innerH - (i / (n - 1)) * innerH;
  }
  // Compact axis labels ("1.2k" not "1,200.00") -- the axis column is narrow.
  function axisFmt(v) {
    const r = Math.round(v);
    if (Math.abs(r) >= 1000) return (r / 1000).toFixed(r % 1000 === 0 ? 0 : 1) + 'k';
    return String(r);
  }
  let contribPoints = $derived(goalActivityByMonth.map((d, i) => `${chartX(i)},${chartY(d.contribute)}`).join(' '));
  let spendPoints = $derived(goalActivityByMonth.map((d, i) => `${chartX(i)},${chartY(d.spend)}`).join(' '));
  function monthLabel(m) {
    const [y, mo] = m.split('-');
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-MY', { month: 'short' });
  }

  // One combined, most-recent-first feed across every goal's allocations
  // AND spends -- unlike the 3-stat row above, this genuinely scales with
  // how much you've actually used goals, which is what actually fixes the
  // "not enough height" problem rather than papering over it with a fixed
  // block. Capped at 15 -- a bounded list, not a full unbounded history (the
  // per-goal Contributions list in Goal Detail already covers that).
  let recentGoalActivity = $derived.by(() => {
    const entries = [];
    for (const g of goalList) {
      for (const a of g.allocations || []) {
        // A `starting` allocation is what the goal already had before it
        // was ever tracked here -- not something that happened on that
        // date, even though it's stamped with one. Showing it in a
        // "Recent activity" feed would read as a contribution you just
        // made, when it's really historical record-keeping.
        if (a.starting) continue;
        if (!a.date) continue;
        entries.push({ date: a.date, amount: a.amount, desc: allocLabel(a), goalLabel: g.label, goalColor: g.color });
      }
      for (const s of g.spends || []) {
        if (!s.date) continue;
        entries.push({ date: s.date, amount: -spendRM(g, s), desc: s.label || 'Spend', goalLabel: g.label, goalColor: g.color });
      }
    }
    return entries.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 15);
  });

  // Loan log -- purely a manual record of who owes who, kept entirely
  // separate from budget/expense calculations (see LoanLogSheet). Lives
  // here rather than Home now -- ported over as-is (2026-08-10), same
  // card, just relocated.
  let loanList = $derived($loans ?? []);
  let loanLent = $derived(round2(loanList.filter((l) => l.direction === 'lent').reduce((s, l) => s + l.amount, 0)));
  let loanOwed = $derived(round2(loanList.filter((l) => l.direction === 'borrowed').reduce((s, l) => s + l.amount, 0)));
  let loanLogOpen = $state(false);

  function bankName(id) {
    return banksList.find((b) => b.bank.id === id)?.bank.name ?? null;
  }
  // Describes where one allocation's money actually went, for the
  // Contributions list -- the giving/reserving distinction is now just
  // whether heldInBankId is set, not a goal-level type.
  function allocLabel(a) {
    if (a.starting) return a.fromBankId ? `Starting balance · already in ${bankName(a.fromBankId) ?? 'this bank'}` : 'Starting balance';
    if (a.amount < 0) {
      if (a.fromUntracked) {
        return a.movedToBankId ? `Starting balance → deposited into ${bankName(a.movedToBankId) ?? 'a bank'}` : 'Starting balance → removed';
      }
      const from = bankName(a.heldInBankId) ?? 'this bank';
      if (a.spentElsewhere) return `Spent on another expense (from ${from})`;
      return a.movedToBankId ? `Taken from ${from} → moved to ${bankName(a.movedToBankId) ?? 'another bank'}` : `Taken from ${from} → back to free balance`;
    }
    const from = bankName(a.fromBankId) ?? 'Unknown bank';
    if (a.heldInBankId == null) return `${from} → given away`;
    if (a.heldInBankId === a.fromBankId) return `${from} → kept here`;
    return `${from} → ${bankName(a.heldInBankId) ?? 'another bank'}`;
  }

  // ---------- panels ----------
  let detailGoalId = $state(null);
  let detailGoal = $derived(detailGoalId ? goalList.find((g) => g.id === detailGoalId) : null);
  let gdEditing = $state(false);
  let closedOpen = $state(false);
  let newGoalOpen = $state(false);

  // Whichever of these four .sheet-page screens (see app.css) is open,
  // Goals' own real content needs to be display:none rather than just
  // visually covered -- same reasoning as Home.svelte's anySheetOpen.
  let anySheetOpen = $derived(detailGoal != null || newGoalOpen || closedOpen || loanLogOpen);
  $effect(() => {
    anySheetOpen;
    window.scrollTo(0, 0);
  });

  // Goal Detail/New Goal/Closed Goals live directly in this file rather
  // than as separate components (unlike LoanLogSheet, which already
  // registers itself) -- so unlike every other .sheet-page in the app,
  // these three never told App.svelte's TabBar to hide itself while they
  // were open, leaving the floating tab bar visible behind them the whole
  // time. loanLogOpen is deliberately excluded here since LoanLogSheet
  // already increments/decrements this same counter on its own; including
  // it too would just double-count that one case.
  let anyOwnSheetOpen = $derived(detailGoal != null || newGoalOpen || closedOpen);
  $effect(() => {
    if (!anyOwnSheetOpen) return;
    sheetPageCount.update((n) => n + 1);
    return () => sheetPageCount.update((n) => n - 1);
  });

  function fmtDate(d) {
    if (!d) return '';
    // Migrated entries carry a plain "YYYY-MM" month key; real entries are ISO.
    if (/^\d{4}-\d{2}$/.test(d)) return d;
    const dt = new Date(d);
    return isNaN(dt) ? d : dt.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function openDetail(g) {
    // Every .sheet shares the same fixed z-index (app.css), so whichever one
    // is later in this file's markup paints on top whenever two are open at
    // once. "Closed goals" is defined after the detail sheet, so opening a
    // goal from that list (or, defensively, any other secondary sheet) left
    // the detail sheet completely hidden underneath it -- visible in the DOM
    // but unreachable on screen. Closing the others here means only one
    // sheet is ever open at a time, which sidesteps the stacking issue
    // instead of trying to out-z-index it.
    closedOpen = false;
    newGoalOpen = false;
    detailGoalId = g.id;
    gdEditing = false;
    takeOpen = false;
  }

  function goAdd(mode, goalId) {
    detailGoalId = null;
    openAdd({ mode, goalId });
  }

  // ---------- goal detail actions ----------
  // Closing a goal doesn't move any real money -- whatever was reserved in a
  // real bank just stops counting toward computeBankReserved() (that filters
  // out closed goals), so it silently becomes "unreserved" there. Reserve
  // that was never tied to a bank is different -- a deliberate starting
  // balance, or (for a goal that predates bank-tagging entirely) old
  // contributions that were never linked to one -- either way there's
  // nowhere for it to "return" to, it just stops being tracked. The toast
  // has to say both parts separately, or "RM500 unreserved" reads as if
  // RM500 of real spendable money just appeared somewhere, when only the
  // bank-tied portion actually did.
  async function closeGoal(g) {
    await db.goals.update(g.id, { closed: 1 });
    const trackedReserve = goalReserveByBank(g).reduce((s, x) => s + x.amount, 0);
    const untracked = round2(Math.max(0, goalReserveLeft(g) - trackedReserve));
    detailGoalId = null;
    closedOpen = true;
    if (trackedReserve > 0.005 && untracked > 0.005) {
      showToast(`Closed · RM ${fmt(trackedReserve)} unreserved, RM ${fmt(untracked)} not tied to a bank`);
    } else if (trackedReserve > 0.005) {
      showToast(`Closed · RM ${fmt(trackedReserve)} unreserved`);
    } else if (untracked > 0.005) {
      showToast(`Closed · RM ${fmt(untracked)} was never tied to a bank`);
    } else {
      showToast('Goal closed');
    }
  }
  async function reopenGoal(g) {
    await db.goals.update(g.id, { closed: 0 });
    showToast(`${g.label} reopened`);
  }
  let confirmDeleteGoalId = $state(null);
  async function deleteGoal(g) {
    await db.goals.delete(g.id);
    detailGoalId = null;
    confirmDeleteGoalId = null;
    showToast('Goal deleted');
  }

  // Reverses whatever real bank effect the original spend had (see
  // AddExpenseSheet's spendgoal branch) -- older, pre-multi-bank spends have
  // no bankId at all, so there's nothing to reverse for those.
  async function deleteGoalSpend(g, idx) {
    const s = g.spends[idx];
    const spendsArr = g.spends.filter((_, i) => i !== idx);
    await db.transaction('rw', db.goals, db.banks, async () => {
      await db.goals.update(g.id, { spends: spendsArr });
      if (s.bankId) await adjustBankBalance(s.bankId, spendRM(g, s));
    });
    confirmDeleteSpendIdx = null;
  }

  // inline spend edit
  let editSpendIdx = $state(null);
  let confirmDeleteSpendIdx = $state(null);
  let editSpendLabel = $state('');
  let editSpendAmt = $state('');
  function startEditSpend(g, idx) {
    editSpendIdx = idx;
    editSpendLabel = g.spends[idx].label;
    editSpendAmt = String(g.spends[idx].amount);
  }
  async function saveEditSpend(g) {
    const amt = parseFloat(editSpendAmt);
    if (!amt) return showToast('Enter an amount first');
    const s = g.spends[editSpendIdx];
    const newS = { ...s, label: editSpendLabel.trim() || 'Spend', amount: amt };
    const spendsArr = g.spends.map((x, i) => (i === editSpendIdx ? newS : x));
    await db.transaction('rw', db.goals, db.banks, async () => {
      await db.goals.update(g.id, { spends: spendsArr });
      if (s.bankId) {
        const delta = round2(spendRM(g, newS) - spendRM(g, s));
        if (delta) await adjustBankBalance(s.bankId, -delta);
      }
    });
    editSpendIdx = null;
  }

  // inline allocation ("Contributions") edit -- every allocation already
  // debited a real bank the moment it was created (see AddExpenseSheet's
  // addgoal branch), so editing/deleting here has to reverse/reapply that
  // same effect, not just touch the label. heldInBankId === fromBankId means
  // the money never actually left ("stays in this bank"), so that case
  // touches no bank at all.
  let editAllocIdx = $state(null);
  let confirmDeleteAllocIdx = $state(null);
  let editAllocAmt = $state('');
  function startEditAlloc(g, idx) {
    editAllocIdx = idx;
    editAllocAmt = String(Math.abs(g.allocations[idx].amount));
  }
  // A negative amount marks a "take from goal" withdrawal (see openTake/
  // saveTake below) -- its bank effect is the mirror image of a normal
  // contribution's: heldInBankId is where it's taken FROM, movedToBankId
  // (if set) is where it lands, and staying with no movedToBankId never
  // touches a bank at all (same as a contribution that "stays in place").
  async function saveEditAlloc(g) {
    const inputAmt = parseFloat(editAllocAmt);
    if (!inputAmt) return showToast('Enter an amount first');
    const a = g.allocations[editAllocIdx];
    const isTake = a.amount < 0;
    const newAmount = isTake ? -Math.abs(inputAmt) : Math.abs(inputAmt);
    const allocations = g.allocations.map((x, i) => (i === editAllocIdx ? { ...x, amount: newAmount } : x));
    await db.transaction('rw', db.goals, db.banks, async () => {
      await db.goals.update(g.id, { allocations });
      if (isTake) {
        if (a.movedToBankId) {
          const extra = round2(Math.abs(newAmount) - Math.abs(a.amount));
          if (extra) {
            await adjustBankBalance(a.heldInBankId, -extra);
            await adjustBankBalance(a.movedToBankId, extra);
          }
        }
      } else {
        const delta = round2(newAmount - a.amount);
        if (delta && a.heldInBankId !== a.fromBankId) {
          await adjustBankBalance(a.fromBankId, -delta);
          if (a.heldInBankId) await adjustBankBalance(a.heldInBankId, delta);
        }
      }
    });
    editAllocIdx = null;
  }
  async function deleteAlloc(g, idx) {
    const a = g.allocations[idx];
    const allocations = g.allocations.filter((_, i) => i !== idx);
    await db.transaction('rw', db.goals, db.banks, async () => {
      await db.goals.update(g.id, { allocations });
      if (a.amount < 0) {
        if (a.movedToBankId) {
          await adjustBankBalance(a.heldInBankId, Math.abs(a.amount));
          await adjustBankBalance(a.movedToBankId, -Math.abs(a.amount));
        }
      } else if (a.heldInBankId !== a.fromBankId) {
        await adjustBankBalance(a.fromBankId, a.amount);
        if (a.heldInBankId) await adjustBankBalance(a.heldInBankId, -a.amount);
      }
    });
    confirmDeleteAllocIdx = null;
    showToast('Removed');
  }

  // ---------- take from goal (withdraw reserve, don't count it as spent) ----------
  // A goal's reserve isn't always sitting in a real bank -- a starting
  // balance entered at creation was never tied to one. That portion is
  // whatever's left after goalReserveByBank's real-bank buckets are
  // subtracted from the overall total.
  function untrackedReserve(g) {
    const attributed = goalReserveByBank(g).reduce((s, x) => s + x.amount, 0);
    return round2(Math.max(0, goalReserveLeft(g) - attributed));
  }
  function takeSourceOptions(g) {
    const untracked = untrackedReserve(g);
    return [...goalReserveByBank(g), ...(untracked > 0.005 ? [{ bankId: UNTRACKED, amount: untracked }] : [])];
  }

  let takeOpen = $state(false);
  let takeAmt = $state('');
  let takeSourceBankId = $state(null);
  let takeDest = $state('same'); // 'same' | 'other'
  let takeDestBankId = $state(null);
  function openTake(g) {
    takeSourceBankId = takeSourceOptions(g)[0]?.bankId ?? null;
    takeAmt = '';
    takeDest = 'same';
    takeDestBankId = null;
    takeOpen = true;
  }
  async function saveTake(g) {
    const amt = parseFloat(takeAmt);
    if (!amt) return showToast('Enter an amount first');
    if (!takeSourceBankId) return showToast('Pick where this is coming from');
    const left = goalReserveLeft(g);
    if (amt > left + 0.005) return showToast(`Only RM ${fmt(left)} is reserved for this goal`);
    if (takeDest === 'other' && !takeDestBankId) return showToast('Pick which bank to send it to');
    const isUntracked = takeSourceBankId === UNTRACKED;
    const movedToBankId = takeDest === 'other' ? takeDestBankId : undefined;
    const allocations = [
      ...(g.allocations || []),
      {
        date: new Date().toISOString(),
        cycleMonth: currentMonth,
        amount: -amt,
        movedToBankId,
        // Untracked money was never a real bank bucket to begin with -- no
        // heldInBankId means goalReserveByBank() correctly leaves it out of
        // every bank's attribution, same as the starting-balance entry it's
        // drawing down. adjustBankBalance() below already no-ops on an
        // undefined bank id, so there's nothing to debit either.
        ...(isUntracked ? { fromUntracked: true } : { heldInBankId: takeSourceBankId }),
      },
    ];
    await db.transaction('rw', db.goals, db.banks, async () => {
      await db.goals.update(g.id, { allocations });
      if (movedToBankId) {
        if (!isUntracked) await adjustBankBalance(takeSourceBankId, -amt);
        await adjustBankBalance(movedToBankId, amt);
      }
    });
    takeOpen = false;
    showToast(`Took RM ${fmt(amt)} out of ${g.label}`);
  }

  // ---------- goal edit form ----------
  let egLabel = $state('');
  let egTarget = $state('');
  let egColor = $state(GOAL_COLORS[0]);
  let egCcy = $state('');
  let egRate = $state('');
  function startEditGoal(g) {
    egLabel = g.label;
    egTarget = String(g.target);
    egColor = g.color;
    egCcy = g.currency || '';
    egRate = g.rate ? String(g.rate) : '';
    gdEditing = true;
  }
  async function saveEditGoal(g) {
    const ccy = egCcy.trim().toUpperCase();
    await db.goals.update(g.id, {
      label: egLabel.trim() || g.label,
      target: parseFloat(egTarget) || g.target,
      color: egColor,
      currency: ccy || null,
      rate: ccy ? parseFloat(egRate) || g.rate || 1 : null,
    });
    gdEditing = false;
  }

  // ---------- new goal ----------
  let ngLabel = $state('');
  let ngTarget = $state('');
  let ngColor = $state(GOAL_COLORS[0]);
  let ngCcy = $state('');
  let ngRate = $state('');
  let ngStartBalance = $state('');
  // null = not tied to any bank (fully untracked, e.g. cash at home).
  let ngStartBankId = $state(null);
  // Mutually exclusive with ngStartBankId -- this starting balance was
  // already spent/given away for good before it was ever tracked here, not
  // sitting reserved anywhere (see createGoal's allocIsReserved comment).
  let ngStartGiven = $state(false);
  let startBalanceWarnMsg = $state('');
  let startBalanceConfirmed = $state(false);
  function openNewGoal() {
    ngLabel = '';
    ngTarget = '';
    ngColor = GOAL_COLORS[0];
    ngCcy = '';
    ngRate = '';
    ngStartBalance = '';
    ngStartBankId = null;
    ngStartGiven = false;
    startBalanceWarnMsg = '';
    startBalanceConfirmed = false;
    newGoalOpen = true;
  }
  async function createGoal() {
    const target = parseFloat(ngTarget);
    if (!ngLabel.trim() || !target) return showToast('Give the goal a name and target');
    const ccy = ngCcy.trim().toUpperCase();
    // Already-saved money from before this goal was tracked here -- no bank
    // to debit for it (it's not a new transaction), just a starting point
    // for the progress bar/reserve. See allocLabel() for how it's shown.
    const startBalance = round2(parseFloat(ngStartBalance) || 0);

    if (startBalance > 0 && ngStartBankId && !startBalanceConfirmed) {
      const bank = banksList.find((b) => b.bank.id === ngStartBankId);
      if (bank) {
        // Whatever's already reserved for OTHER goals in this bank isn't
        // free to also claim as this goal's starting point -- only the
        // leftover, unreserved slice of the balance genuinely "makes sense"
        // as a starting balance sitting in this bank.
        const free = round2(bank.balance - computeBankReserved(goalList, bank.id));
        if (startBalance > free + 0.005) {
          startBalanceWarnMsg = `${bank.bank.name}'s balance is RM ${fmt(bank.balance)}, but only RM ${fmt(Math.max(0, free))} of it is free right now (the rest is already reserved for other goals) — that's RM ${fmt(round2(startBalance - free))} more than what's actually free there.`;
          return;
        }
      }
    }

    const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const order = (goalList.reduce((m, g) => Math.max(m, g.order || 0), 0) || 0) + 1;
    const allocations = startBalance > 0
      ? [{
          date: new Date().toISOString(),
          cycleMonth: currentMonth,
          amount: startBalance,
          starting: true,
          // Tied to a bank: heldInBankId === fromBankId is the same "stays
          // in this bank" shape addgoal already uses, so it's earmarked
          // (shows in that bank's "Reserved for goals") without touching
          // the balance -- this money was already counted in it. Given
          // away: heldInBankId explicitly null (not just omitted) so
          // allocIsReserved reads it as spent for good, not reserved --
          // omitting the field entirely would fall back to the goal's old
          // `type`, which no longer exists on goals created here.
          ...(ngStartGiven ? { heldInBankId: null } : ngStartBankId ? { fromBankId: ngStartBankId, heldInBankId: ngStartBankId } : {}),
        }]
      : [];
    await db.goals.put({
      id,
      label: ngLabel.trim(),
      target,
      color: ngColor,
      order,
      currency: ccy || null,
      rate: ccy ? parseFloat(ngRate) || 1 : null,
      closed: 0,
      allocations,
      spends: [],
    });
    newGoalOpen = false;
    showToast(`Goal created · ${ngLabel.trim()}`);
  }

</script>

<div style:display={anySheetOpen ? 'none' : 'contents'}>
<h2 class="title">Goals</h2>
<p class="sub">Save up, then put it where it counts.</p>

<div class="section-hd" data-guide="goals-list"><h3>Your goals</h3><span>{activeGoals.length} active</span></div>
{#each activeGoals as g (g.id)}
  {@const alloc = goalAllocated(g)}
  {@const left = goalReserveLeft(g)}
  {@const reached = goalReached(g)}
  {@const pct = g.target > 0 ? Math.min(100, Math.round((alloc / g.target) * 100)) : 0}
  <div class="card goal-card" class:reached style="border-color: {g.color}; box-shadow: 4px 4px 0 {g.color};" onclick={() => openDetail(g)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && openDetail(g)}>
    <div class="goal-top">
      <span class="goal-name"><span class="dot" style="background:{g.color}"></span><span class="goal-name-text">{g.label}</span></span>
      <span class="goal-nums"><b class="num">{fmt(alloc)}</b> / {fmt(g.target)}</span>
    </div>
    <div class="track"><div class="fill" style="width:{pct}%; background:{reached ? 'var(--good)' : g.color}"></div></div>
    <div class="goal-foot">
      {#if reached}
        <span class="goal-state done">{left > 0.005 ? '✓ Funded · ready to spend' : '✓ Reached'}</span>
        <button class="goal-action" onclick={(e) => { e.stopPropagation(); left > 0.005 ? goAdd('spendgoal', g.id) : openDetail(g); }}>{left > 0.005 ? 'Spend ›' : 'View ›'}</button>
      {:else}
        <span class="goal-state">RM {fmt(g.target - alloc)} to go · {pct}%</span>
        <button class="goal-action" onclick={(e) => { e.stopPropagation(); goAdd('addgoal', g.id); }}>Add</button>
      {/if}
    </div>
  </div>
{:else}
  <p class="hint" style="margin:2px 0;">No goals yet — create your first below.</p>
{/each}
<button class="new-goal-btn" onclick={openNewGoal}>+ New goal</button>

<div class="nav-rows">
  <button class="nav-row" onclick={() => (closedOpen = true)}>
    <span>Closed goals</span>
    <span class="nav-meta">{closedGoals.length}<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
  </button>
</div>

<div class="card" data-guide="loan-log-card" style="display:flex; align-items:center; justify-content:space-between; margin-top:16px; margin-bottom:16px; cursor:pointer;" onclick={() => (loanLogOpen = true)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (loanLogOpen = true)}>
  <div>
    <div style="font-size:11.5px; color:var(--lo); font-weight:600;">Loan log</div>
    {#if loanList.length}
      <div style="display:flex; gap:14px; margin-top:2px;">
        <div><span class="num" style="font-size:17px; font-weight:700; color:var(--good);">RM {fmt(loanLent)}</span><div style="font-size:10.5px; color:var(--dim);">you lent</div></div>
        <div><span class="num" style="font-size:17px; font-weight:700; color:var(--red);">RM {fmt(loanOwed)}</span><div style="font-size:10.5px; color:var(--dim);">you owe</div></div>
      </div>
    {:else}
      <div class="num" style="font-size:19px; font-weight:700; margin-top:2px; color:var(--dim);">No loans logged</div>
    {/if}
    <div style="font-size:11px; color:var(--dim); margin-top:6px;">Manual record — doesn't affect your balance</div>
  </div>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="color:var(--dim); flex-shrink:0;"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
</div>

<div class="section-hd" style="margin-top:32px;"><h3>Goal activity</h3></div>
<div class="card contrib-card">
  <div class="chart-pager">
    <button class="icon-btn small" aria-label="Previous month" disabled={!canChartGoBack} onclick={chartGoBack}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <span class="chart-pager-range">{monthLabel(windowStartMonth)} – {monthLabel(effectiveEndMonth)}</span>
    <button class="icon-btn small" aria-label="Next month" disabled={!canChartGoForward} onclick={chartGoForward}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  </div>
  <div class="chart-legend">
    <div class="chart-legend-item">
      <span class="chart-legend-lbl"><span class="dot" style="background:var(--good);"></span>Contribute</span>
      <span class="num chart-legend-amt" style="color:var(--good);">RM {fmt(totalContributed)}</span>
    </div>
    <div class="chart-legend-item right">
      <span class="chart-legend-lbl"><span class="dot" style="background:var(--red);"></span>Spend</span>
      <span class="num chart-legend-amt" style="color:var(--red);">RM {fmt(totalSpentFromGoals)}</span>
    </div>
  </div>
  <div class="activity-chart-row">
    <svg viewBox="0 0 {AXIS_W} {CHART_H}" width={AXIS_W} height={CHART_H} class="activity-chart-axis" aria-hidden="true">
      {#each chartYTicks as t, i}
        <text x={AXIS_W - 4} y={tickY(i, chartYTicks.length) + 3} font-size="11" font-weight="700" text-anchor="end" fill="var(--dim)">{axisFmt(t)}</text>
      {/each}
    </svg>
    <div class="activity-chart-plot">
      <svg viewBox="0 0 {PLOT_W} {CHART_H}" width="100%" height={CHART_H} class="activity-chart" role="img" aria-label="Contribute and spend by month">
        {#each chartYTicks as t, i}
          <line x1="0" y1={tickY(i, chartYTicks.length)} x2={PLOT_W} y2={tickY(i, chartYTicks.length)} stroke="var(--stroke-2)" stroke-opacity="0.15" stroke-width="1" />
        {/each}
        {#each goalActivityByMonth as d, i}
          <text x={chartX(i)} y={CHART_H - 4} font-size="10" font-weight="700" text-anchor="middle" fill="var(--dim)">{monthLabel(d.month).toUpperCase()}</text>
        {/each}
        <polyline points={contribPoints} fill="none" stroke="var(--good)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <polyline points={spendPoints} fill="none" stroke="var(--red)" stroke-width="2" stroke-dasharray="5 3" stroke-linecap="round" stroke-linejoin="round" />
        {#each goalActivityByMonth as d, i}
          <circle cx={chartX(i)} cy={chartY(d.contribute)} r="3" fill="var(--good)" />
          <circle cx={chartX(i)} cy={chartY(d.spend)} r="3" fill="var(--red)" />
        {/each}
      </svg>
    </div>
  </div>
</div>

<div class="section-hd" style="margin-top:22px;"><h3>Recent activity</h3></div>
<div class="card">
  {#each recentGoalActivity as e (e.date + e.desc + e.amount)}
    <div class="set-row">
      <span class="dot" style="background:{e.goalColor}; flex-shrink:0;"></span>
      <div style="flex:1; min-width:0;">
        <div class="tx-note-main">{e.goalLabel}</div>
        <div class="tx-date">{fmtDate(e.date)} · {e.desc}</div>
      </div>
      <span class="num tx-amt" style="color:{e.amount < 0 ? 'var(--red)' : 'var(--good)'};">{e.amount < 0 ? '−' : '+'}RM {fmt(Math.abs(e.amount))}</span>
    </div>
  {:else}
    <p class="hint" style="margin:2px 0;">Nothing logged yet — contributions and spends across all your goals will show up here.</p>
  {/each}
</div>
</div>

<!-- ===================== GOAL DETAIL SHEET ===================== -->
<div class="sheet-page" class:open={detailGoal != null} use:swipeBack={() => (detailGoalId = null)}>
  <div class="sheet-page-hd">
    <button class="icon-btn" aria-label="Close" onclick={() => (detailGoalId = null)}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>{detailGoal?.label ?? 'Goal'}</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-page-body">
    {#if detailGoal}
      {@const g = detailGoal}
      {@const alloc = goalAllocated(g)}
      {@const spent = goalSpent(g)}
      {@const left = goalReserveLeft(g)}
      {@const reached = goalReached(g)}
      {@const pct = g.target > 0 ? Math.min(100, Math.round((alloc / g.target) * 100)) : 0}
      {#if gdEditing}
        <div class="field-lbl" style="margin-top:6px;">Goal name</div>
        <input class="note-input" bind:value={egLabel} />
        <div class="field-lbl">Target amount (RM)</div>
        <input class="note-input num" bind:value={egTarget} inputmode="decimal" />
        <p class="hint">Change the target any time — the bar just recalculates.</p>
        <div class="field-lbl">Colour</div>
        <div class="color-row">
          {#each GOAL_COLORS as c}
            <div class="color-dot" class:sel={egColor === c} style="background:{c}" role="button" tabindex="0" onclick={() => (egColor = c)} onkeydown={(e) => e.key === 'Enter' && (egColor = c)}></div>
          {/each}
        </div>
        <div class="field-lbl">Spend currency <span style="text-transform:none; letter-spacing:0; color:var(--dim); font-weight:600;">optional</span></div>
        <input class="note-input" bind:value={egCcy} placeholder="Currency code, e.g. SGD — blank = RM only" />
        <div class="rate-line"><span>1 {egCcy.trim().toUpperCase() || 'unit'}</span><span class="lo">= RM</span><input class="note-input num" bind:value={egRate} placeholder="3.50" inputmode="decimal" /></div>
        <p class="hint" style="margin-top:6px;">How many ringgit one unit costs (1 SGD = RM 3.50). Update whenever it moves — it re-converts every spend in this goal.</p>
        <div style="display:flex; gap:8px; margin-top:18px;">
          <button class="io-btn" style="flex:1;" onclick={() => (gdEditing = false)}>Cancel</button>
          <button class="save-btn" style="flex:1; margin-top:0;" onclick={() => saveEditGoal(g)}>Save changes</button>
        </div>
      {:else}
        <div class="card" style="margin-bottom:16px;">
          <div class="goal-top" style="margin-bottom:12px;">
            <span class="goal-name"><span class="dot" style="background:{g.color}"></span><span class="goal-name-text">{g.label}</span></span>
            <span class="goal-nums"><b class="num">{fmt(alloc)}</b> / {fmt(g.target)}</span>
          </div>
          <div class="track"><div class="fill" style="width:{pct}%; background:{reached ? 'var(--good)' : g.color}"></div></div>
          <div class="goal-state" class:done={reached} style="margin-top:10px;">
            {reached ? '✓ Funded' : `RM ${fmt(g.target - alloc)} to go · ${pct}%`}
          </div>
        </div>

        <div class="field-lbl" style="margin-top:0;">Contributions</div>
        <div class="card">
          {#each g.allocations ?? [] as a, i}
            {#if editAllocIdx === i}
              <div class="dividend-edit">
                <input class="note-input num" bind:value={editAllocAmt} inputmode="decimal" placeholder="0.00" />
                <div style="display:flex; gap:8px;">
                  <button class="io-btn" style="flex:1;" onclick={() => (editAllocIdx = null)}>Cancel</button>
                  <button class="save-btn" style="flex:1; margin-top:0;" onclick={() => saveEditAlloc(g)}>Save</button>
                </div>
              </div>
            {:else}
              <div class="set-row" style="padding:10px 4px;">
                <div style="flex:1; min-width:0;">
                  <div style="font-size:13px;">{fmtDate(a.date)}</div>
                  <div style="font-size:11px; color:var(--dim); margin-top:2px;">{allocLabel(a)}</div>
                </div>
                <span class="num" style="font-size:13px; color:{a.amount < 0 ? 'var(--red)' : 'inherit'};">{a.amount < 0 ? '−' : ''}RM {fmt(Math.abs(a.amount))}</span>
                <button class="icon-btn small" aria-label="Edit contribution" onclick={() => startEditAlloc(g, i)}>
                  <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
                </button>
                <button class="icon-btn small" aria-label="Delete contribution" onclick={() => (confirmDeleteAllocIdx = i)}>
                  <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
              </div>
              {#if confirmDeleteAllocIdx === i}
                <div class="del-confirm">
                  <span>Delete this RM {fmt(Math.abs(a.amount))} contribution?</span>
                  <div style="display:flex; gap:8px; margin-top:8px;">
                    <button class="io-btn" style="flex:1;" onclick={() => (confirmDeleteAllocIdx = null)}>Cancel</button>
                    <button class="save-btn danger" style="flex:1; margin-top:0;" onclick={() => deleteAlloc(g, i)}>Delete</button>
                  </div>
                </div>
              {/if}
            {/if}
          {:else}
            <p class="hint" style="margin:2px 0;">Nothing added yet.</p>
          {/each}
        </div>

        <div class="field-lbl">Spent · <span class="num">RM {fmt(spent)}</span> of {fmt(alloc)} set aside</div>
          <div class="card">
            {#each g.spends ?? [] as s, i}
              {#if editSpendIdx === i}
                <div class="dividend-edit">
                  <input class="note-input" bind:value={editSpendLabel} placeholder="What was it for?" />
                  <input class="note-input num" bind:value={editSpendAmt} inputmode="decimal" placeholder="0.00" />
                  <div style="display:flex; gap:8px;">
                    <button class="io-btn" style="flex:1;" onclick={() => (editSpendIdx = null)}>Cancel</button>
                    <button class="save-btn" style="flex:1; margin-top:0;" onclick={() => saveEditSpend(g)}>Save</button>
                  </div>
                </div>
              {:else}
                <div class="set-row" data-si={i}>
                  <div style="flex:1;">
                    <div style="font-size:13.5px; font-weight:600;">{s.label}</div>
                    <div style="font-size:11px; color:var(--dim); font-family:var(--mono); margin-top:2px;">{fmtDate(s.date)}{s.bankId ? ` · ${bankName(s.bankId) ?? 'Unknown bank'}` : ''}</div>
                  </div>
                  <span class="num" style="margin-right:8px; font-size:12.5px;">
                    {#if g.currency && s.ccy === g.currency}{s.ccy} {fmt(s.amount)} <span style="color:var(--dim)">· RM {fmt(spendRM(g, s))}</span>{:else}RM {fmt(s.amount)}{/if}
                  </span>
                  <button class="icon-btn small" aria-label="Edit spend" onclick={() => startEditSpend(g, i)}>
                    <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
                  </button>
                  <button class="icon-btn small" aria-label="Delete spend" onclick={() => (confirmDeleteSpendIdx = i)}>
                    <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
                {#if confirmDeleteSpendIdx === i}
                  <div class="del-confirm">
                    <span>Delete this {s.label} spend?</span>
                    <div style="display:flex; gap:8px; margin-top:8px;">
                      <button class="io-btn" style="flex:1;" onclick={() => (confirmDeleteSpendIdx = null)}>Cancel</button>
                      <button class="save-btn danger" style="flex:1; margin-top:0;" onclick={() => deleteGoalSpend(g, i)}>Delete</button>
                    </div>
                  </div>
                {/if}
              {/if}
            {:else}
              <p class="hint" style="margin:2px 0;">Nothing spent from this goal yet.</p>
            {/each}
          </div>
          {#if !g.closed}
            {#if left > 0.005}
              <div style="display:flex; gap:8px;">
                <button class="new-goal-btn" style="color:var(--good); border-color:rgba(74,222,128,0.4);" onclick={() => goAdd('spendgoal', g.id)}>+ Log a spend</button>
                <button class="new-goal-btn" onclick={() => openTake(g)}>Take from goal</button>
              </div>
            {:else}
              <p class="hint" style="margin-top:8px;">Nothing reserved to spend or take out right now.</p>
            {/if}
          {/if}

          {#if !g.closed && takeOpen}
            {@const sourceOptions = takeSourceOptions(g)}
            {@const isUntracked = takeSourceBankId === UNTRACKED}
            {@const sourceBank = banksList.find((b) => b.bank.id === takeSourceBankId)}
            <div class="card" style="margin-top:10px;">
              <div class="field-lbl" style="margin-top:0;">Amount to take out (RM)</div>
              <input class="note-input num" bind:value={takeAmt} inputmode="decimal" placeholder="0.00" />
              {#if sourceOptions.length > 1}
                <div class="field-lbl">From which bank's reserve?</div>
                <div class="chip-scroll">
                  {#each sourceOptions as x (x.bankId)}
                    {#if x.bankId === UNTRACKED}
                      <button class="chip ghost" class:selected={takeSourceBankId === UNTRACKED} onclick={() => (takeSourceBankId = UNTRACKED)}>Starting balance</button>
                    {:else}
                      {@const b = banksList.find((bb) => bb.bank.id === x.bankId)}
                      {#if b}
                        <button class="chip" class:selected={takeSourceBankId === x.bankId} onclick={() => (takeSourceBankId = x.bankId)}>
                          <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} size={18} />
                          {b.bank.name}
                        </button>
                      {/if}
                    {/if}
                  {/each}
                </div>
              {:else if isUntracked}
                <p class="hint" style="margin:0 0 10px;">Taking from the starting balance you entered — that was never tied to a bank here.</p>
              {/if}
              <div class="field-lbl">Send it to</div>
              <div class="chip-grid">
                <button class="chip ghost" class:selected={takeDest === 'same'} onclick={() => (takeDest = 'same')}>{isUntracked ? "Don't add to a bank" : `Keep in ${sourceBank?.bank.name ?? 'the same bank'}`}</button>
                <button class="chip ghost" class:selected={takeDest === 'other'} onclick={() => (takeDest = 'other')}>{isUntracked ? 'Deposit into a bank' : 'Move to another bank'}</button>
              </div>
              {#if takeDest === 'other'}
                <div class="chip-scroll">
                  {#each banksList.filter((b) => b.bank.id !== takeSourceBankId) as b (b.bank.id)}
                    <button class="chip" class:selected={takeDestBankId === b.bank.id} onclick={() => (takeDestBankId = b.bank.id)}>
                      <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} size={18} />
                      {b.bank.name}
                    </button>
                  {/each}
                </div>
              {/if}
              <p class="hint" style="margin-top:6px;">
                {#if takeDest === 'other'}
                  {isUntracked ? `Deposits as new free balance in ${banksList.find((b) => b.bank.id === takeDestBankId)?.bank.name ?? 'the bank you pick'} -- wasn't tracked in a bank before.` : `Moves out of ${sourceBank?.bank.name ?? 'that bank'} and becomes free balance in ${banksList.find((b) => b.bank.id === takeDestBankId)?.bank.name ?? 'the bank you pick'} -- no longer reserved for ${g.label}.`}
                {:else}
                  {isUntracked ? `Just stops counting toward ${g.label} -- it was never in a bank here, so nothing else changes.` : `Stays exactly where it is -- just stops being earmarked for ${g.label}, so it's free to spend on anything.`}
                {/if}
              </p>
              <div style="display:flex; gap:8px; margin-top:10px;">
                <button class="io-btn" style="flex:1;" onclick={() => (takeOpen = false)}>Cancel</button>
                <button class="save-btn" style="flex:1; margin-top:0;" onclick={() => saveTake(g)}>Take out</button>
              </div>
            </div>
          {/if}

        {#if !g.closed && alloc < g.target}
          <button class="new-goal-btn" style="margin-top:12px;" onclick={() => goAdd('addgoal', g.id)}>+ Add to this goal</button>
        {/if}

        {#if g.closed}
          <div class="card" style="margin-top:16px; display:flex; align-items:center; justify-content:space-between;">
            <span class="pill neutral">Closed</span>
            <button class="io-btn" style="width:auto; padding:10px 16px;" onclick={() => reopenGoal(g)}>Reopen goal</button>
          </div>
          <p class="hint" style="margin-top:8px;">Closed goals don't take new contributions, spends, or withdrawals — reopen it first if you need to add more activity.</p>
        {:else}
          <div class="card" style="margin-top:16px; display:flex; align-items:center; justify-content:space-between;">
            <div><div style="font-size:12px; color:var(--lo);">Reserved, not yet spent</div><div class="num" style="font-size:19px; font-weight:700; margin-top:2px;">RM {fmt(left)}</div></div>
            <button class="save-btn" style="width:auto; margin:0; padding:12px 16px;" onclick={() => closeGoal(g)}>{left > 0.005 ? 'Close & return' : 'Close goal'}</button>
          </div>
        {/if}

        <div style="display:flex; gap:8px; margin-top:16px;">
          <button class="io-btn" style="flex:1;" onclick={() => startEditGoal(g)}>Edit goal</button>
          {#if (g.allocations?.length ?? 0) === 0 && (g.spends?.length ?? 0) === 0}
            <button class="io-btn" style="flex:1; color:var(--red);" onclick={() => (confirmDeleteGoalId = g.id)}>Delete</button>
          {/if}
        </div>
        {#if confirmDeleteGoalId === g.id}
          <div class="del-confirm">
            <span>Delete "{g.label}"? This can't be undone.</span>
            <div style="display:flex; gap:8px; margin-top:8px;">
              <button class="io-btn" style="flex:1;" onclick={() => (confirmDeleteGoalId = null)}>Cancel</button>
              <button class="save-btn danger" style="flex:1; margin-top:0;" onclick={() => deleteGoal(g)}>Delete</button>
            </div>
          </div>
        {/if}
        <p class="hint" style="margin-top:12px;">Every contribution leaves its bank right away — check the note under each one to see whether it's kept aside, moved, or given away for good.</p>
      {/if}
    {/if}
  </div>
</div>

<!-- ===================== NEW GOAL SHEET ===================== -->
<div class="sheet-page" class:open={newGoalOpen} use:swipeBack={() => (newGoalOpen = false)}>
  <div class="sheet-page-hd">
    <button class="icon-btn" aria-label="Close" onclick={() => (newGoalOpen = false)}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>New goal</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-page-body">
    <div class="field-lbl" style="margin-top:6px;">Goal name</div>
    <input class="note-input" placeholder="e.g. Emergency fund, Umrah, New laptop" bind:value={ngLabel} />
    <div class="field-lbl">Target amount (RM)</div>
    <input class="note-input num" placeholder="0.00" inputmode="decimal" bind:value={ngTarget} />
    <div class="field-lbl">Starting balance <span style="text-transform:none; letter-spacing:0; color:var(--dim); font-weight:600;">optional</span></div>
    <input class="note-input num" placeholder="0.00 — already saved before today" inputmode="decimal" bind:value={ngStartBalance} onchange={() => { startBalanceWarnMsg = ''; startBalanceConfirmed = false; }} />
    {#if parseFloat(ngStartBalance) > 0}
      <div class="field-lbl">Is this still sitting somewhere, or already given away?</div>
      <div class="chip-scroll">
        <button class="chip ghost" class:selected={!ngStartGiven && ngStartBankId === null} onclick={() => { ngStartBankId = null; ngStartGiven = false; startBalanceWarnMsg = ''; }}>Not tied to a bank</button>
        {#each banksList as b (b.bank.id)}
          <button class="chip" class:selected={!ngStartGiven && ngStartBankId === b.bank.id} onclick={() => { ngStartBankId = b.bank.id; ngStartGiven = false; startBalanceWarnMsg = ''; }}>
            <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} size={18} />
            {b.bank.name}
          </button>
        {/each}
        <button class="chip ghost" class:selected={ngStartGiven} onclick={() => { ngStartGiven = true; ngStartBankId = null; startBalanceWarnMsg = ''; }}>Already given away</button>
      </div>
      <p class="hint" style="margin-top:6px;">
        {#if ngStartGiven}Already spent/given away for good before today — counts toward this goal's progress, but isn't reserved anywhere and won't show as "Reserved for goals" on any bank.
        {:else if ngStartBankId}Earmarks it in {banksList.find((b) => b.bank.id === ngStartBankId)?.bank.name} without touching that bank's balance — it's already counted there. Shows as "Reserved for goals" on that bank's card.
        {:else}Not tracked against any bank — just a number to count toward this goal (e.g. cash at home, or an amount you'd rather not tie to a specific account).{/if}
      </p>
    {:else}
      <p class="hint" style="margin-top:6px;">Already have some money set aside for this? Count it toward the goal — you can edit or remove it later from the goal's Contributions list.</p>
    {/if}
    <div class="field-lbl">Colour</div>
    <div class="color-row">
      {#each GOAL_COLORS as c}
        <div class="color-dot" class:sel={ngColor === c} style="background:{c}" role="button" tabindex="0" onclick={() => (ngColor = c)} onkeydown={(e) => e.key === 'Enter' && (ngColor = c)}></div>
      {/each}
    </div>
    <div class="field-lbl">Spend in another currency? <span style="text-transform:none; letter-spacing:0; color:var(--dim); font-weight:600;">optional</span></div>
    <input class="note-input" placeholder="Currency code, e.g. SGD — blank = RM only" bind:value={ngCcy} />
    <div class="rate-line"><span>1 {ngCcy.trim().toUpperCase() || 'unit'}</span><span class="lo">= RM</span><input class="note-input num" placeholder="3.50" inputmode="decimal" bind:value={ngRate} /></div>
    <p class="hint" style="margin-top:6px;">How many ringgit one unit of that currency costs (1 SGD = RM 3.50). You can change the rate any time from the goal.</p>
    <p class="hint" style="margin-top:10px;">Once created, add to it from any bank — pick whether that money stays put, moves somewhere else, or is given away for good.</p>
    {#if startBalanceWarnMsg}
      <p class="hint" style="margin-top:14px; color:var(--gold); font-weight:600;">{startBalanceWarnMsg}</p>
      <div style="display:flex; gap:8px; margin-top:8px;">
        <button class="io-btn" style="flex:1;" onclick={() => (startBalanceWarnMsg = '')}>Cancel</button>
        <button class="save-btn" style="flex:1; margin-top:0;" onclick={() => { startBalanceConfirmed = true; createGoal(); }}>Create anyway</button>
      </div>
    {:else}
      <button class="save-btn" style="margin-top:14px;" onclick={createGoal}>Create goal</button>
    {/if}
  </div>
</div>

<!-- ===================== CLOSED GOALS SHEET ===================== -->
<div class="sheet-page" class:open={closedOpen} use:swipeBack={() => (closedOpen = false)}>
  <div class="sheet-page-hd">
    <button class="icon-btn" aria-label="Close" onclick={() => (closedOpen = false)}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>Closed goals</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-page-body">
    <p class="sub" style="margin-top:4px;">Goals you've spent or completed.</p>
    {#each closedGoals as g (g.id)}
      {@const alloc = goalAllocated(g)}
      {@const spent = goalSpent(g)}
      <div class="card goal-card closed" style="border-color: {g.color}; box-shadow: 4px 4px 0 {g.color};" onclick={() => openDetail(g)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && openDetail(g)}>
        <div class="goal-top">
          <span class="goal-name"><span class="dot" style="background:{g.color}"></span><span class="goal-name-text">{g.label}</span></span>
          <span class="goal-nums"><b class="num">{fmt(alloc)}</b> / {fmt(g.target)}</span>
        </div>
        <div class="goal-foot"><span class="goal-state">RM {fmt(alloc)} total · RM {fmt(spent)} spent</span><span class="pill neutral">Closed</span></div>
      </div>
    {:else}
      <p class="hint">No closed goals yet — reached goals land here once you close or complete them.</p>
    {/each}
  </div>
</div>

<LoanLogSheet open={loanLogOpen} onClose={() => (loanLogOpen = false)} />

<style>
  .contrib-card { margin-top: 14px; }
  .chart-pager { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
  .chart-pager-range { font-size: 13px; font-weight: 700; color: var(--lo); }
  .chart-pager .icon-btn.small:disabled { opacity: 0.35; }
  .chart-legend { display: flex; justify-content: space-between; margin-bottom: 4px; }
  .chart-legend-item { display: flex; flex-direction: column; gap: 3px; }
  .chart-legend-item.right { align-items: flex-end; }
  .chart-legend-lbl { display: flex; align-items: center; gap: 5px; font-size: 9.5px; font-weight: 700; color: var(--lo); text-transform: uppercase; letter-spacing: 0.03em; }
  .chart-legend-amt { font-size: 13px; font-weight: 700; }
  .activity-chart-row { display: flex; margin-top: 14px; }
  .activity-chart-axis { flex-shrink: 0; }
  .activity-chart-plot { flex: 1; min-width: 0; }
  .activity-chart { display: block; }

  /* Same row typography as BankTransactionsSheet/CategoryDetailSheet/
     BufferDetailSheet/ReimbursementsSheet's transaction lists -- this list
     is the same shape (dot + note/date + amount) and should read the same,
     not have its own one-off inline sizes. */
  .tx-note-main { font-size: 12px; font-weight: 600; color: var(--hi); }
  .tx-date { font-size: 10px; color: var(--dim); margin-top: 2px; }
  .tx-amt { font-size: 12.5px; font-weight: 700; flex-shrink: 0; }

  .goal-card { margin-bottom: 10px; cursor: pointer; }
  .goal-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  /* min-width:0 here is the actual fix -- without it, a flex item's default
     min-width is auto (content-based), which for a long goal name held it
     at its full natural width instead of letting it shrink, pushing
     .goal-nums (the RM amount, needs to stay visible) off to the side or
     forcing the whole row to overflow the card. */
  .goal-name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 14.5px; font-weight: 700; }
  .goal-name-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .goal-nums { font-family: var(--mono); font-size: 12.5px; color: var(--lo); white-space: nowrap; flex-shrink: 0; }
  .goal-nums b { color: var(--hi); font-weight: 600; }
  .goal-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
  .goal-state { font-size: 11.5px; font-family: var(--mono); color: var(--dim); }
  .goal-state.done { color: var(--good); font-family: var(--body); font-weight: 700; }
  .goal-action { background: none; border: 1.5px solid var(--stroke-2); border-radius: 12px; padding: 6px 12px; font-size: 12px; font-weight: 700; color: var(--gold); font-family: var(--body); }
  .goal-card.closed { opacity: 0.55; }
  .goal-card.closed .goal-name { color: var(--lo); }

  .new-goal-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-top: 12px; padding: 13px 0; border: 2px dashed var(--stroke-2); border-radius: 14px; color: var(--gold); font-size: 13px; font-weight: 700; background: none; }

  .nav-rows { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
  .nav-row { display: flex; align-items: center; justify-content: space-between; width: 100%; background: var(--panel); border: 2px solid var(--stroke-2); border-radius: 16px; box-shadow: 3px 3px 0 var(--stroke-2); padding: 15px 16px; color: var(--hi); font-size: 14px; font-weight: 700; font-family: var(--body); }
  .nav-row .nav-meta { display: flex; align-items: center; gap: 10px; color: var(--dim); font-family: var(--mono); font-size: 13px; font-weight: 600; }

  /* .chip-scroll is only ever defined per-component (see AddExpenseSheet.svelte/
     BankTransactionsSheet.svelte) -- Svelte scopes component styles, so using
     the class name here without a matching local rule left these bank rows
     with no flex/overflow styling at all, stacking one per line instead of
     scrolling side by side. */
  .chip-scroll {
    display: flex; gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    margin-bottom: 6px;
    padding: 2px 2px 4px;
  }
  .chip-scroll::-webkit-scrollbar { display: none; }
  .chip-scroll .chip { flex-shrink: 0; }

  .rate-line { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 14px; color: var(--hi); font-weight: 600; }
  .rate-line .note-input { width: 110px; padding: 10px 12px; }
  .rate-line .lo { color: var(--lo); font-weight: 600; }

  .color-row { display: flex; gap: 10px; margin-top: 2px; flex-wrap: wrap; }
  .color-dot { width: 32px; height: 32px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
  .color-dot.sel { border-color: var(--hi); }

  .icon-btn.small { width: 28px; height: 28px; }
  .icon-btn.small + .icon-btn.small { margin-left: 6px; }
  .dividend-edit { padding: 8px 0; border-bottom: 1px solid var(--stroke); }
  .dividend-edit .note-input { margin-bottom: 8px; }
</style>
