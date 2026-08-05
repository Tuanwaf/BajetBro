<script>
  import { currentMonth, template, hutangPots, goals } from '../lib/stores.js';
  import { goalAllocated, goalReserveLeft, goalReached } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { BUFFER_COLOR, BUFFER_LABEL_PRESETS } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { currentView } from '../lib/viewStore.js';

  let { open, onClose, intent = null, originRect = null } = $props();

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
  // Only for the shape's transform (position/scale) -- overshoots past the
  // target then settles back, like a button's press-release squish, so the
  // circle shrinks a hair smaller than the FAB then springs back to its
  // exact size. Deliberately a much gentler overshoot than the tab bar's
  // active-icon pop (1.56) -- this transform's scaleX/scaleY ratios are very
  // different (the FAB's ~60px square target comes from a 390px-wide but
  // 844px-tall viewport), so the SAME overshoot curve applied to both axes
  // doesn't overshoot by the same amount on each -- verified via Playwright
  // that 1.56 made height briefly collapse to near-zero while width only
  // dipped modestly, a squished flat oval instead of a clean bounce. 1.08 is
  // small enough that the mismatch between axes stays imperceptible. Border-
  // radius/background keep SHRINK_EASE: an overshoot past 50% border-radius
  // has no visible effect once it's already a circle, so bouncing it would
  // just be wasted motion.
  const SHRINK_BOUNCE = 'cubic-bezier(0.34, 1.08, 0.64, 1)';

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
    const transformAnim = sheetEl.animate(
      [
        { transform: 'translate(0px, 0px) scale(1, 1)' },
        { transform: `translate(${rect.left}px, ${rect.top}px) scale(${sx}, ${sy})` },
      ],
      { duration: SHRINK_MS, easing: SHRINK_BOUNCE, fill: 'forwards' }
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
  let pots = $derived($hutangPots ?? []);
  let goalList = $derived(($goals ?? []).filter((g) => !g.closed));
  // Editable from Settings -> Buffer labels; falls back to the built-in
  // defaults for templates created before that field existed.
  let bufferLabels = $derived(tmpl?.bufferLabels ?? BUFFER_LABEL_PRESETS);

  // 'addgoal' = put money into a goal (reserve / give), 'spendgoal' = itemized
  // spend out of a savings goal, 'spend' = personal spend from the pool.
  let selectedCatKey = $state(null);
  let selectedBufferLabel = $state(null);
  let customBufferLabel = $state('');
  let selectedGoalId = $state(null);
  let addCcy = $state('RM');
  let kpCents = $state(0);
  let noteValue = $state('');

  const MAX_CENTS = 99999999;
  let kpDisplay = $derived((kpCents / 100).toFixed(2));
  let step = $state(1); // 1 = amount, 2 = category + note

  let selectedGoal = $derived(goalList.find((g) => g.id === selectedGoalId) || null);
  // Goals eligible for a "spend on a goal" entry: savings goals with reserve left.
  let spendGoals = $derived(goalList.filter((g) => g.type === 'savings' && goalReserveLeft(g) > 0.005));
  let amtCur = $derived(selectedCatKey === 'spendgoal' && selectedGoal?.currency ? addCcy : 'RM');

  function reset() {
    selectedCatKey = null;
    selectedBufferLabel = null;
    customBufferLabel = '';
    selectedGoalId = null;
    addCcy = 'RM';
    kpCents = 0;
    noteValue = '';
    step = 1;
  }

  $effect(() => {
    if (open) {
      reset();
      applyIntent(intent);
    }
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

  function selectCat(key) {
    selectedCatKey = key;
    selectedBufferLabel = null;
    customBufferLabel = '';
    selectedGoalId = null;
    addCcy = 'RM';
  }

  function selectGoal(g) {
    selectedGoalId = g.id;
    // Default a foreign-currency goal to its own currency (most trip spends
    // are local); flip to RM for ringgit-priced things like a flight.
    addCcy = selectedCatKey === 'spendgoal' && g.currency ? g.currency : 'RM';
  }

  async function save() {
    const amt = kpCents / 100;
    if (!selectedCatKey || !amt) {
      showToast('Pick a category and amount first');
      return;
    }
    const note = noteValue.trim();
    const now = new Date().toISOString();

    if (selectedCatKey === 'buffer') {
      const label = selectedBufferLabel === 'custom' ? customBufferLabel.trim() || 'Misc' : selectedBufferLabel || 'Misc';
      const extras = [...(month.extras || []), { name: label, actual: amt, date: now, note: note || undefined }];
      await db.months.update(month.key, { extras });
      // A new custom label becomes a permanent quick-pick chip (and shows up
      // in Settings), same as if it had been added there directly.
      if (selectedBufferLabel === 'custom' && label && !bufferLabels.includes(label)) {
        await db.template.put({ ...tmpl, bufferLabels: [...bufferLabels, label] });
      }
      showToast(`Saved RM ${fmt(amt)} · Buffer / ${label}`);
      onClose();
      currentView.set('home');
      return;
    }

    if (selectedCatKey === 'addgoal') {
      if (!selectedGoal) return showToast('Pick a goal first');
      const room = Math.max(0, selectedGoal.target - goalAllocated(selectedGoal));
      const applied = Math.min(amt, room);
      if (applied <= 0) return showToast('This goal is already at its target');
      const allocations = [...(selectedGoal.allocations || []), { date: now, amount: applied }];
      await db.goals.update(selectedGoal.id, { allocations });
      const verb = selectedGoal.type === 'giving' ? 'Added to' : 'Reserved for';
      showToast(`${verb} ${selectedGoal.label} · RM ${fmt(applied)}${applied < amt ? ' (capped to target)' : ''}`);
      onClose();
      currentView.set('goals');
      return;
    }

    if (selectedCatKey === 'spendgoal') {
      if (!selectedGoal) return showToast('Pick a goal first');
      const spends = [...(selectedGoal.spends || []), { date: now, label: note || 'Spend', amount: amt, ccy: addCcy }];
      await db.goals.update(selectedGoal.id, { spends });
      showToast(`Spent ${amtCur} ${fmt(amt)} · ${selectedGoal.label}`);
      onClose();
      currentView.set('goals');
      return;
    }

    if (selectedCatKey === 'spend') {
      await db.savingsSpends.add({ date: now, label: note || 'Personal spend', amount: amt });
      showToast(`Spent RM ${fmt(amt)} from savings`);
      onClose();
      currentView.set('goals');
      return;
    }

    if (selectedCatKey === 'reimburse') {
      const reimbursements = [...(month.reimbursements || []), { amount: amt, date: now, note: note || undefined }];
      await db.months.update(month.key, { reimbursements });
      showToast(`Paid back to you · RM ${fmt(amt)}`);
      onClose();
      currentView.set('home');
      return;
    }

    // A fixed category expense.
    const categories = month.categories.map((c) =>
      c.key === selectedCatKey
        ? {
            ...c,
            actual: c.actual + amt,
            transactions: [...(c.transactions || []), { amount: amt, date: now, note: note || undefined }],
          }
        : c
    );
    await db.months.update(month.key, { categories });

    // Saving is what actually feeds the shared pool: it opens/grows this
    // month's pot (its `initial`), which flows into "Ready to allocate".
    if (selectedCatKey === 'saving') {
      const existingPot = pots.find((p) => p.month === month.key);
      if (existingPot) await db.hutangPots.update(month.key, { initial: existingPot.initial + amt });
      else await db.hutangPots.put({ month: month.key, initial: amt });
    }

    const cat = tmpl.categories.find((c) => c.key === selectedCatKey);
    showToast(`Saved RM ${fmt(amt)} · ${cat?.name ?? ''}`);
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
    <div class="field-lbl" style="margin-top:2px;">Category</div>
    <div class="chip-grid">
      {#if tmpl}
        {#each tmpl.categories as cat (cat.key)}
          <button class="chip" class:selected={selectedCatKey === cat.key} style="color:{cat.color}" onclick={() => selectCat(cat.key)}>
            <span class="dot" style="background:{cat.color}"></span>{cat.name}
          </button>
        {/each}
      {/if}
      <button class="chip" class:selected={selectedCatKey === 'buffer'} style="color:{BUFFER_COLOR}" onclick={() => selectCat('buffer')}>
        <span class="dot" style="background:{BUFFER_COLOR}"></span>Buffer
      </button>
      <button class="chip" class:selected={selectedCatKey === 'addgoal'} style="color:#b07af2" onclick={() => selectCat('addgoal')}>
        <span class="dot" style="background:#b07af2"></span>Add to a goal
      </button>
      <button class="chip" class:selected={selectedCatKey === 'spendgoal'} style="color:#3ddcb0" onclick={() => selectCat('spendgoal')}>
        <span class="dot" style="background:#3ddcb0"></span>Spend on a goal
      </button>
      <button class="chip" class:selected={selectedCatKey === 'spend'} style="color:#f2a154" onclick={() => selectCat('spend')}>
        <span class="dot" style="background:#f2a154"></span>Spend from savings
      </button>
      <button class="chip" class:selected={selectedCatKey === 'reimburse'} style="color:var(--good)" onclick={() => selectCat('reimburse')}>
        <span class="dot" style="background:var(--good)"></span>Paid back to me
      </button>
    </div>

    {#if selectedCatKey === 'reimburse'}
      <p class="hint">Money someone paid you back — credited to <b>this month's</b> Remaining, kept separate from your income. Use this when the payback arrives in a later month than the expense (for a same-month bill split, edit the expense instead).</p>
    {/if}

    {#if selectedCatKey === 'buffer'}
      <div class="field-lbl">Buffer label</div>
      <div class="chip-grid">
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
      <div class="chip-grid">
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
        <p class="hint">
          {#if selectedGoal.type === 'giving'}Goes toward {selectedGoal.label} — leaves your savings for good.
          {:else}Reserved in Tabung Haji for {selectedGoal.label} — still yours and still growing until you spend it.{/if}
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
        <p class="hint">Comes out of money set aside for {selectedGoal.label} — it won't touch this month's budget or History.</p>
      {/if}
    {/if}

    {#if selectedCatKey === 'spend'}
      <p class="hint">Takes money out of your savings pool for a personal purchase — not tied to any goal, and reduces what's available to allocate.</p>
    {/if}

    <div class="field-lbl">Note (optional)</div>
    <input class="note-input" placeholder="e.g. Deposit, top-up, refund…" bind:value={noteValue} />
    </div>

      <div class="save-wrap">
        <button class="save-btn" disabled={!selectedCatKey} onclick={save}>Save</button>
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
     Chromium -- same signature as that earlier bug. */
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

  /* step 1 — amount near the top, big circular iPhone-style keypad filling below */
  .amt-big { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; padding: 20px 20px 4px; }
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
  .save-wrap {
    flex-shrink: 0;
    padding: 10px 20px calc(env(safe-area-inset-bottom, 0px) + 18px);
    border-top: 1px solid var(--stroke);
    background: var(--ink);
  }
  .save-btn:disabled { opacity: 0.4; }
</style>
