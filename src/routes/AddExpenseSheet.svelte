<script>
  import { currentMonth, template, hutangPots, goals } from '../lib/stores.js';
  import { goalAllocated, goalReserveLeft, goalReached } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { ADHOC_COLOR, ADHOC_LABEL_PRESETS } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { currentView } from '../lib/viewStore.js';

  let { open, onClose, intent = null } = $props();

  let month = $derived($currentMonth);
  let tmpl = $derived($template);
  let pots = $derived($hutangPots ?? []);
  let goalList = $derived(($goals ?? []).filter((g) => !g.closed));

  // 'addgoal' = put money into a goal (reserve / give), 'spendgoal' = itemized
  // spend out of a savings goal, 'spend' = personal spend from the pool.
  let selectedCatKey = $state(null);
  let selectedAdhocLabel = $state(null);
  let customAdhocLabel = $state('');
  let selectedGoalId = $state(null);
  let addCcy = $state('RM');
  let kpCents = $state(0);
  let noteValue = $state('');

  const MAX_CENTS = 99999999;
  let kpDisplay = $derived((kpCents / 100).toFixed(2));

  let selectedGoal = $derived(goalList.find((g) => g.id === selectedGoalId) || null);
  // Goals eligible for a "spend on a goal" entry: savings goals with reserve left.
  let spendGoals = $derived(goalList.filter((g) => g.type === 'savings' && goalReserveLeft(g) > 0.005));
  let amtCur = $derived(selectedCatKey === 'spendgoal' && selectedGoal?.currency ? addCcy : 'RM');

  function reset() {
    selectedCatKey = null;
    selectedAdhocLabel = null;
    customAdhocLabel = '';
    selectedGoalId = null;
    addCcy = 'RM';
    kpCents = 0;
    noteValue = '';
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
      if (g) selectGoal(g);
    }
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
    selectedAdhocLabel = null;
    customAdhocLabel = '';
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

    if (selectedCatKey === 'adhoc') {
      const label = selectedAdhocLabel === 'custom' ? customAdhocLabel.trim() || 'Misc' : selectedAdhocLabel || 'Misc';
      const extras = [...(month.extras || []), { name: label, actual: amt, date: now, note: note || undefined }];
      await db.months.update(month.key, { extras });
      showToast(`Saved RM ${fmt(amt)} · Ad-hoc / ${label}`);
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

<div class="sheet" class:open>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>Add entry</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-body">
    <div class="amt-display"><span class="cur">{amtCur}</span><span class="val">{kpDisplay}</span></div>

    <div class="field-lbl">Category</div>
    <div class="chip-grid">
      {#if tmpl}
        {#each tmpl.categories as cat (cat.key)}
          <button class="chip" class:selected={selectedCatKey === cat.key} style="color:{cat.color}" onclick={() => selectCat(cat.key)}>
            <span class="dot" style="background:{cat.color}"></span>{cat.name}
          </button>
        {/each}
      {/if}
      <button class="chip" class:selected={selectedCatKey === 'adhoc'} style="color:{ADHOC_COLOR}" onclick={() => selectCat('adhoc')}>
        <span class="dot" style="background:{ADHOC_COLOR}"></span>Ad-hoc
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
      <button class="chip" class:selected={selectedCatKey === 'reimburse'} style="color:#4ade80" onclick={() => selectCat('reimburse')}>
        <span class="dot" style="background:#4ade80"></span>Paid back to me
      </button>
    </div>

    {#if selectedCatKey === 'reimburse'}
      <p class="hint">Money someone paid you back — credited to <b>this month's</b> Remaining, kept separate from your income. Use this when the payback arrives in a later month than the expense (for a same-month bill split, edit the expense instead).</p>
    {/if}

    {#if selectedCatKey === 'adhoc'}
      <div class="field-lbl">Ad-hoc label</div>
      <div class="chip-grid">
        {#each ADHOC_LABEL_PRESETS as label}
          <button class="chip ghost" class:selected={selectedAdhocLabel === label} style={selectedAdhocLabel === label ? `color:${ADHOC_COLOR}` : ''} onclick={() => (selectedAdhocLabel = label)}>{label}</button>
        {/each}
        <button class="chip ghost" class:selected={selectedAdhocLabel === 'custom'} style={selectedAdhocLabel === 'custom' ? `color:${ADHOC_COLOR}` : ''} onclick={() => (selectedAdhocLabel = 'custom')}>+ Custom</button>
      </div>
      {#if selectedAdhocLabel === 'custom'}
        <input class="note-input" placeholder="Type your own label…" bind:value={customAdhocLabel} />
      {/if}
    {/if}

    {#if selectedCatKey === 'addgoal' || selectedCatKey === 'spendgoal'}
      <div class="field-lbl">{selectedCatKey === 'spendgoal' ? 'Spend from which goal?' : 'Which goal?'}</div>
      <div class="chip-grid">
        {#each (selectedCatKey === 'spendgoal' ? spendGoals : goalList) as g (g.id)}
          <button class="chip ghost" class:selected={selectedGoalId === g.id} style={selectedGoalId === g.id ? `color:${g.color}` : ''} onclick={() => selectGoal(g)}>
            <span class="dot" style="background:{g.color}"></span>{g.label}
          </button>
        {:else}
          <p class="hint" style="margin:0 0 6px;">
            {selectedCatKey === 'spendgoal' ? 'No goals with money set aside yet.' : 'No goals yet — create one on the Goals tab.'}
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

    <div class="field-lbl">Amount</div>
    <div class="keypad">
      {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'] as k}
        <button class="key" class:op={k === '⌫'} onclick={(e) => pressKey(k, e)}>{k}</button>
      {/each}
    </div>

    <button class="save-btn" onclick={save}>Save</button>
  </div>
</div>
