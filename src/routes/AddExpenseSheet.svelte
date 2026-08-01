<script>
  import { currentMonth, template, hutangPots, goals } from '../lib/stores.js';
  import { goalAllocated, goalReserveLeft, goalReached } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { BUFFER_COLOR, BUFFER_LABEL_PRESETS } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { currentView } from '../lib/viewStore.js';

  let { open, onClose, intent = null } = $props();

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
    const rest = { backgroundColor: cs.backgroundColor, borderColor: cs.borderColor, color: cs.color };
    const lit = { backgroundColor: '#e7b34e', borderColor: '#e7b34e', color: '#241a05' };
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

    if (selectedCatKey === 'unreserve') {
      if (!selectedGoal) return showToast('Pick a goal first');
      const reserveLeft = goalReserveLeft(selectedGoal);
      const applied = Math.min(amt, reserveLeft);
      if (applied <= 0) return showToast('Nothing reserved to take back');
      // A negative allocation -- reduces goalAllocated (and so goalReserveLeft)
      // without touching spends, then flows straight back into Ready to allocate.
      const allocations = [...(selectedGoal.allocations || []), { date: now, amount: -applied }];
      await db.goals.update(selectedGoal.id, { allocations });
      showToast(`Took back RM ${fmt(applied)} from ${selectedGoal.label}${applied < amt ? ' (capped to what was reserved)' : ''}`);
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

<div class="sheet add-sheet" class:open>
  <div class="add-track" class:step2={step === 2}>

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
            <svg viewBox="0 0 24 24" fill="none"><path d="M5 12.5l5 5L19 6.5" stroke="#241a05" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
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
      <button class="chip" class:selected={selectedCatKey === 'unreserve'} style="color:#7dd3fc" onclick={() => selectCat('unreserve')}>
        <span class="dot" style="background:#7dd3fc"></span>Take back to pool
      </button>
      <button class="chip" class:selected={selectedCatKey === 'spend'} style="color:#f2a154" onclick={() => selectCat('spend')}>
        <span class="dot" style="background:#f2a154"></span>Spend from savings
      </button>
      <button class="chip" class:selected={selectedCatKey === 'reimburse'} style="color:#4ade80" onclick={() => selectCat('reimburse')}>
        <span class="dot" style="background:#4ade80"></span>Paid back to me
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

    {#if selectedCatKey === 'addgoal' || selectedCatKey === 'spendgoal' || selectedCatKey === 'unreserve'}
      <div class="field-lbl">{selectedCatKey === 'spendgoal' ? 'Spend from which goal?' : selectedCatKey === 'unreserve' ? 'Take back from which goal?' : 'Which goal?'}</div>
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

      {#if selectedCatKey === 'unreserve' && selectedGoal}
        <p class="hint">Un-reserves this amount from {selectedGoal.label} back into Ready to allocate — for changing your mind, not for spending on the goal's purpose (use "Spend on a goal" for that). Capped at RM {fmt(goalReserveLeft(selectedGoal))} still reserved.</p>
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
  .add-sheet { overflow: hidden; }
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
  .key.next { background: var(--gold); border-color: var(--gold); }
  .key.next:disabled { opacity: 0.35; }
  .key.next svg { width: 28px; height: 28px; }

  /* step 2 */
  .amt-sum { flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 2px 0 12px; }
  .amt-sum .cur { font-size: 15px; color: var(--lo); margin-right: 2px; }
  .amt-sum .v { font-family: var(--mono); font-size: 26px; font-weight: 600; }
  .amt-sum .edit-amt { font-size: 11px; color: var(--gold); font-weight: 700; border: 1px solid var(--stroke-2); border-radius: 99px; padding: 3px 10px; background: none; margin-left: 6px; }
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
