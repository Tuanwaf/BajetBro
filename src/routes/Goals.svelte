<script>
  import { hutangPots, goals, tabungHaji, dividends, savingsSpends } from '../lib/stores.js';
  import {
    computeReadyToAllocate,
    computeOpenSavingsReserve,
    computeTabungHajiTotal2,
    computeDividendsTotal,
    goalAllocated,
    goalSpent,
    goalReserveLeft,
    goalReached,
    spendRM,
    round2,
  } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { openAdd } from '../lib/viewStore.js';
  import { GOAL_COLORS } from '../lib/constants.js';
  import db from '../lib/db.js';

  let pots = $derived($hutangPots ?? []);
  let goalList = $derived($goals ?? []);
  let th = $derived($tabungHaji);
  let divs = $derived($dividends ?? []);
  let spends = $derived($savingsSpends ?? []);

  let activeGoals = $derived(goalList.filter((g) => !g.closed));
  let closedGoals = $derived(goalList.filter((g) => g.closed));

  let pool = $derived(computeReadyToAllocate(pots, goalList, divs, spends));
  let openReserve = $derived(computeOpenSavingsReserve(goalList));
  let thTotal = $derived(computeTabungHajiTotal2(th, pots, goalList, divs, spends));
  let thSavings = $derived(round2(pool + openReserve));
  let dividendsTotal = $derived(computeDividendsTotal(divs));
  let personalSpentTotal = $derived(spends.reduce((s, x) => s + (x.amount || 0), 0));

  // ---------- panels ----------
  let detailGoalId = $state(null);
  let detailGoal = $derived(detailGoalId ? goalList.find((g) => g.id === detailGoalId) : null);
  let gdEditing = $state(false);
  let closedOpen = $state(false);
  let spentOpen = $state(false);
  let newGoalOpen = $state(false);

  function fmtDate(d) {
    if (!d) return '';
    // Migrated entries carry a plain "YYYY-MM" month key; real entries are ISO.
    if (/^\d{4}-\d{2}$/.test(d)) return d;
    const dt = new Date(d);
    return isNaN(dt) ? d : dt.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function openDetail(g) {
    detailGoalId = g.id;
    gdEditing = false;
  }

  function goAdd(mode, goalId) {
    detailGoalId = null;
    openAdd({ mode, goalId });
  }

  // ---------- goal detail actions ----------
  async function closeGoal(g) {
    await db.goals.update(g.id, { closed: 1 });
    const left = goalReserveLeft(g);
    detailGoalId = null;
    closedOpen = true;
    showToast(left > 0 ? `Closed · RM ${fmt(left)} returned to your pool` : 'Goal closed');
  }
  async function completeGoal(g) {
    await db.goals.update(g.id, { closed: 1 });
    detailGoalId = null;
    closedOpen = true;
    showToast('Goal marked complete');
  }
  async function deleteGoal(g) {
    await db.goals.delete(g.id);
    detailGoalId = null;
    showToast('Goal deleted');
  }
  async function deleteGoalSpend(g, idx) {
    const spendsArr = (g.spends || []).filter((_, i) => i !== idx);
    await db.goals.update(g.id, { spends: spendsArr });
  }

  // inline spend edit
  let editSpendIdx = $state(null);
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
    const spendsArr = g.spends.map((s, i) => (i === editSpendIdx ? { ...s, label: editSpendLabel.trim() || 'Spend', amount: amt } : s));
    await db.goals.update(g.id, { spends: spendsArr });
    editSpendIdx = null;
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
  let ngType = $state('savings');
  let ngColor = $state(GOAL_COLORS[0]);
  let ngCcy = $state('');
  let ngRate = $state('');
  function openNewGoal() {
    ngLabel = '';
    ngTarget = '';
    ngType = 'savings';
    ngColor = GOAL_COLORS[0];
    ngCcy = '';
    ngRate = '';
    newGoalOpen = true;
  }
  async function createGoal() {
    const target = parseFloat(ngTarget);
    if (!ngLabel.trim() || !target) return showToast('Give the goal a name and target');
    const ccy = ngCcy.trim().toUpperCase();
    const id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const order = (goalList.reduce((m, g) => Math.max(m, g.order || 0), 0) || 0) + 1;
    await db.goals.put({
      id,
      label: ngLabel.trim(),
      target,
      type: ngType,
      color: ngColor,
      order,
      currency: ccy || null,
      rate: ccy ? parseFloat(ngRate) || 1 : null,
      closed: 0,
      allocations: [],
      spends: [],
    });
    newGoalOpen = false;
    showToast(`Goal created · ${ngLabel.trim()}`);
  }

  // ---------- dividends ----------
  let dividendFormOpen = $state(false);
  let dividendLabel = $state('');
  let dividendAmount = $state('');
  let editingDividendId = $state(null);
  let editDivLabel = $state('');
  let editDivAmount = $state('');

  async function addDividend() {
    const amt = parseFloat(dividendAmount);
    if (!amt) return showToast('Enter a dividend amount first');
    const label = dividendLabel.trim() || `Dividend ${divs.length + 1}`;
    await db.dividends.add({ label, amount: amt, date: new Date().toISOString() });
    dividendFormOpen = false;
    dividendLabel = '';
    dividendAmount = '';
    showToast(`Added ${label} · RM ${fmt(amt)}`);
  }
  function startEditDividend(d) {
    editingDividendId = d.id;
    editDivLabel = d.label;
    editDivAmount = String(d.amount);
  }
  async function saveEditDividend() {
    const amt = parseFloat(editDivAmount);
    if (!amt) return showToast('Enter a dividend amount first');
    await db.dividends.update(editingDividendId, { label: editDivLabel.trim() || 'Dividend', amount: amt });
    editingDividendId = null;
    showToast('Dividend updated');
  }
  async function deleteDividend(d) {
    await db.dividends.delete(d.id);
    showToast(`Removed ${d.label}`);
  }

  // ---------- personal spends (Spent from savings) ----------
  let editingSpendId = $state(null);
  let editPsLabel = $state('');
  let editPsAmount = $state('');
  function startEditPersonalSpend(s) {
    editingSpendId = s.id;
    editPsLabel = s.label;
    editPsAmount = String(s.amount);
  }
  async function savePersonalSpend() {
    const amt = parseFloat(editPsAmount);
    if (!amt) return showToast('Enter an amount first');
    await db.savingsSpends.update(editingSpendId, { label: editPsLabel.trim() || 'Personal spend', amount: amt });
    editingSpendId = null;
    showToast('Updated');
  }
  async function deletePersonalSpend(s) {
    await db.savingsSpends.delete(s.id);
    showToast('Removed');
  }
</script>

<h2 class="title">Goals</h2>
<p class="sub">Save up, then put it where it counts.</p>

<div class="balance-card">
  <div class="balance-top"><div class="lbl">Ready to allocate</div></div>
  <div class="balance-amt"><span class="cur">RM</span>{fmt(pool)}</div>
  <div style="font-size:12px; color:var(--lo); position:relative; z-index:1;">From your Saving each month plus dividends — spread it across your goals below. Anything left over grows in Tabung Haji.</div>
  <div class="pool-actions">
    <button class="primary" onclick={() => goAdd('addgoal')}>Add to a goal</button>
    <button class="ghost" onclick={() => goAdd('spend')}>Spend from savings</button>
  </div>
</div>

<div class="section-hd"><h3>Your goals</h3><span>{activeGoals.length} active</span></div>
{#each activeGoals as g (g.id)}
  {@const alloc = goalAllocated(g)}
  {@const reached = goalReached(g)}
  {@const pct = g.target > 0 ? Math.min(100, Math.round((alloc / g.target) * 100)) : 0}
  <div class="card goal-card" class:reached onclick={() => openDetail(g)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && openDetail(g)}>
    <div class="goal-top">
      <span class="goal-name"><span class="dot" style="background:{g.color}"></span>{g.label}</span>
      <span class="goal-nums"><b class="num">{fmt(alloc)}</b> / {fmt(g.target)}</span>
    </div>
    <div class="track"><div class="fill" style="width:{pct}%; background:{reached ? 'var(--good)' : g.color}"></div></div>
    <div class="goal-foot">
      {#if reached}
        <span class="goal-state done">{g.type === 'giving' ? '✓ Reached' : '✓ Funded · ready to spend'}</span>
        <button class="goal-action" onclick={(e) => { e.stopPropagation(); openDetail(g); }}>{g.type === 'giving' ? 'View ›' : 'Spend ›'}</button>
      {:else}
        <span class="goal-state">RM {fmt(g.target - alloc)} to go · {pct}%</span>
        <button class="goal-action" onclick={(e) => { e.stopPropagation(); goAdd('addgoal', g.id); }}>{g.type === 'giving' ? 'Add' : 'Reserve'}</button>
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
  <button class="nav-row" onclick={() => (spentOpen = true)}>
    <span>Spent from savings</span>
    <span class="nav-meta">{spends.length}<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
  </button>
</div>

<div class="section-hd"><h3>Where it grows</h3><span>savings &amp; investments</span></div>
{#if th}
  <div class="balance-card" style="margin-bottom:10px;">
    <div class="balance-top"><div class="lbl">Tabung Haji</div><span class="pill good">Active</span></div>
    <div class="balance-amt"><span class="cur">RM</span>{fmt(thTotal)}</div>
    <div class="balance-row">
      <div class="stat"><div class="k">Fixed deposit</div><div class="v num">{fmt(th.fixedDeposit)}</div></div>
      <div class="stat"><div class="k">Savings</div><div class="v num">{fmt(thSavings)}</div></div>
      <div class="stat"><div class="k">Dividend</div><div class="v num up">{fmt(dividendsTotal)}</div></div>
    </div>
    <p style="position:relative; z-index:1; font-size:11px; color:var(--dim); margin:10px 0 0;">Savings = your ready-to-allocate pool + anything reserved in savings goals. Dividends feed the pool too.</p>
    {#if divs.length}
      <div class="dividend-list">
        {#each divs as d (d.id)}
          {#if editingDividendId === d.id}
            <div class="dividend-edit">
              <input class="note-input" placeholder="Label" bind:value={editDivLabel} />
              <input class="note-input num" placeholder="0.00" inputmode="decimal" bind:value={editDivAmount} />
              <div style="display:flex; gap:8px;">
                <button class="io-btn" style="flex:1;" onclick={() => (editingDividendId = null)}>Cancel</button>
                <button class="save-btn" style="flex:1; margin-top:0;" onclick={saveEditDividend}>Save</button>
              </div>
            </div>
          {:else}
            <div class="dividend-row">
              <span class="dividend-label">{d.label}</span>
              <span class="num" style="margin-right:8px;">RM {fmt(d.amount)}</span>
              <button class="icon-btn small" aria-label="Edit dividend" onclick={() => startEditDividend(d)}>
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
              </button>
              <button class="icon-btn small" aria-label="Delete dividend" onclick={() => deleteDividend(d)}>
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
    <button class="add-dividend-btn" onclick={() => (dividendFormOpen = !dividendFormOpen)}>+ Add dividend</button>
    {#if dividendFormOpen}
      <div style="position:relative; z-index:1;">
        <div class="field-lbl" style="margin-top:12px;">Label</div>
        <input class="note-input" placeholder="e.g. 2026 dividend" bind:value={dividendLabel} />
        <div class="field-lbl">Amount</div>
        <input class="note-input num" placeholder="0.00" inputmode="decimal" bind:value={dividendAmount} />
        <button class="save-btn" style="margin-top:10px;" onclick={addDividend}>Save dividend</button>
      </div>
    {/if}
  </div>
{/if}

<div class="card" style="opacity:0.6; border-style:dashed;">
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <div>
      <div style="font-weight:700; font-size:14px;">ASB</div>
      <div style="font-size:11px; color:var(--dim); margin-top:2px;">Planned · higher historical dividend</div>
    </div>
    <span class="pill neutral">Not started</span>
  </div>
</div>
<p class="hint">Once an ASB account opens, it becomes a second growth vehicle here — same pattern as Tabung Haji.</p>

<!-- ===================== GOAL DETAIL SHEET ===================== -->
<div class="sheet" class:open={detailGoal != null}>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={() => (detailGoalId = null)}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>{detailGoal?.label ?? 'Goal'}</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-body">
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
            <span class="goal-name"><span class="dot" style="background:{g.color}"></span>{g.label}</span>
            <span class="goal-nums"><b class="num">{fmt(alloc)}</b> / {fmt(g.target)}</span>
          </div>
          <div class="track"><div class="fill" style="width:{pct}%; background:{reached ? 'var(--good)' : g.color}"></div></div>
          <div class="goal-state" class:done={reached} style="margin-top:10px;">
            {reached ? (g.type === 'giving' ? '✓ Reached' : '✓ Funded') : `RM ${fmt(g.target - alloc)} to go · ${pct}%`}
          </div>
        </div>

        {#if g.type === 'giving'}
          <div class="field-lbl" style="margin-top:0;">Contributions</div>
          <div class="card">
            {#each g.allocations ?? [] as a}
              <div class="set-row" style="padding:10px 4px;"><span style="flex:1; font-size:13px;">{fmtDate(a.date)}</span><span class="num" style="font-size:13px;">RM {fmt(a.amount)}</span></div>
            {:else}
              <p class="hint" style="margin:2px 0;">Nothing added yet.</p>
            {/each}
          </div>
          {#if reached}
            <button class="new-goal-btn" style="margin-top:12px; color:var(--good); border-color:rgba(74,222,128,0.4);" onclick={() => completeGoal(g)}>Mark complete</button>
          {:else}
            <button class="new-goal-btn" style="margin-top:12px;" onclick={() => goAdd('addgoal', g.id)}>+ Add to this goal</button>
          {/if}
        {:else}
          <div class="field-lbl" style="margin-top:0;">Reserved from pool</div>
          <div class="card">
            {#each g.allocations ?? [] as a}
              <div class="set-row" style="padding:10px 4px;"><span style="flex:1; font-size:13px;">{fmtDate(a.date)}</span><span class="num" style="font-size:13px;">RM {fmt(a.amount)}</span></div>
            {:else}
              <p class="hint" style="margin:2px 0;">Nothing reserved yet.</p>
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
                  <div style="flex:1;"><div style="font-size:13.5px; font-weight:600;">{s.label}</div><div style="font-size:11px; color:var(--dim); font-family:var(--mono); margin-top:2px;">{fmtDate(s.date)}</div></div>
                  <span class="num" style="margin-right:8px; font-size:12.5px;">
                    {#if g.currency && s.ccy === g.currency}{s.ccy} {fmt(s.amount)} <span style="color:var(--dim)">· RM {fmt(spendRM(g, s))}</span>{:else}RM {fmt(s.amount)}{/if}
                  </span>
                  <button class="icon-btn small" aria-label="Edit spend" onclick={() => startEditSpend(g, i)}>
                    <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
                  </button>
                  <button class="icon-btn small" aria-label="Delete spend" onclick={() => deleteGoalSpend(g, i)}>
                    <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
              {/if}
            {:else}
              <p class="hint" style="margin:2px 0;">Nothing spent from this goal yet.</p>
            {/each}
          </div>
          <button class="new-goal-btn" style="color:var(--good); border-color:rgba(74,222,128,0.4); margin-top:12px;" onclick={() => goAdd('spendgoal', g.id)}>+ Log a spend</button>
          {#if alloc < g.target}
            <button class="new-goal-btn" style="margin-top:8px;" onclick={() => goAdd('addgoal', g.id)}>+ Reserve more</button>
          {/if}
          <div class="card" style="margin-top:16px; display:flex; align-items:center; justify-content:space-between;">
            <div><div style="font-size:12px; color:var(--lo);">Left in this goal</div><div class="num" style="font-size:19px; font-weight:700; margin-top:2px;">RM {fmt(left)}</div></div>
            <button class="save-btn" style="width:auto; margin:0; padding:12px 16px;" onclick={() => closeGoal(g)}>{left > 0 ? 'Close & return' : 'Close goal'}</button>
          </div>
        {/if}

        <div style="display:flex; gap:8px; margin-top:16px;">
          <button class="io-btn" style="flex:1;" onclick={() => startEditGoal(g)}>Edit goal</button>
          {#if (g.allocations?.length ?? 0) === 0 && (g.spends?.length ?? 0) === 0}
            <button class="io-btn" style="flex:1; color:var(--red);" onclick={() => deleteGoal(g)}>Delete</button>
          {/if}
        </div>
        <p class="hint" style="margin-top:12px;">
          {#if g.type === 'giving'}Each amount added here leaves your savings and goes toward this goal.
          {:else}Reserved money stays in Tabung Haji until you spend it; goal spends never touch this month's History, and any leftover returns to your pool when you close it.{/if}
        </p>
      {/if}
    {/if}
  </div>
</div>

<!-- ===================== NEW GOAL SHEET ===================== -->
<div class="sheet" class:open={newGoalOpen}>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={() => (newGoalOpen = false)}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>New goal</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-body">
    <div class="field-lbl" style="margin-top:6px;">Goal name</div>
    <input class="note-input" placeholder="e.g. Emergency fund, Umrah, New laptop" bind:value={ngLabel} />
    <div class="field-lbl">Target amount (RM)</div>
    <input class="note-input num" placeholder="0.00" inputmode="decimal" bind:value={ngTarget} />
    <div class="field-lbl">How does this goal work?</div>
    <div class="type-row">
      <button class="type-opt" class:sel={ngType === 'savings'} onclick={() => (ngType = 'savings')}>
        <div class="type-t">Save for it</div>
        <div class="type-d">Set money aside and spend it later yourself. It stays in Tabung Haji until you do.</div>
      </button>
      <button class="type-opt" class:sel={ngType === 'giving'} onclick={() => (ngType = 'giving')}>
        <div class="type-t">Give as you go</div>
        <div class="type-d">Money goes out each time you add to it — handed over as you contribute.</div>
      </button>
    </div>
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
    <button class="save-btn" style="margin-top:14px;" onclick={createGoal}>Create goal</button>
  </div>
</div>

<!-- ===================== CLOSED GOALS SHEET ===================== -->
<div class="sheet" class:open={closedOpen}>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={() => (closedOpen = false)}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>Closed goals</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-body">
    <p class="sub" style="margin-top:4px;">Goals you've spent or completed.</p>
    {#each closedGoals as g (g.id)}
      {@const alloc = goalAllocated(g)}
      <div class="card goal-card closed" onclick={() => openDetail(g)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && openDetail(g)}>
        <div class="goal-top">
          <span class="goal-name"><span class="dot" style="background:{g.color}"></span>{g.label}</span>
          <span class="goal-nums"><b class="num">{fmt(alloc)}</b> / {fmt(g.target)}</span>
        </div>
        <div class="goal-foot"><span class="goal-state">{g.type === 'giving' ? `Complete · RM ${fmt(alloc)} given` : `Spent · RM ${fmt(goalSpent(g))}`}</span><span class="pill neutral">{g.type === 'giving' ? 'Complete' : 'Spent'}</span></div>
      </div>
    {:else}
      <p class="hint">No closed goals yet — reached goals land here once you close or complete them.</p>
    {/each}
  </div>
</div>

<!-- ===================== SPENT FROM SAVINGS SHEET ===================== -->
<div class="sheet" class:open={spentOpen}>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={() => (spentOpen = false)}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>Spent from savings</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-body">
    <p class="sub" style="margin-top:4px;">Money pulled from your savings pool for personal buys — logged when you choose "Spend from savings". Edit or remove if something's off.</p>
    <div class="card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:14px; border-color:var(--gold);">
      <span style="font-size:13px; color:var(--lo); font-weight:600;">Total spent from savings</span>
      <span class="num" style="font-size:18px; font-weight:700; color:var(--good);">RM {fmt(personalSpentTotal)}</span>
    </div>
    <div class="card">
      {#each spends as s (s.id)}
        {#if editingSpendId === s.id}
          <div class="dividend-edit">
            <input class="note-input" bind:value={editPsLabel} placeholder="What was it for?" />
            <input class="note-input num" bind:value={editPsAmount} inputmode="decimal" placeholder="0.00" />
            <div style="display:flex; gap:8px;">
              <button class="io-btn" style="flex:1;" onclick={() => (editingSpendId = null)}>Cancel</button>
              <button class="save-btn" style="flex:1; margin-top:0;" onclick={savePersonalSpend}>Save</button>
            </div>
          </div>
        {:else}
          <div class="set-row">
            <div style="flex:1;"><div style="font-size:13.5px; font-weight:600;">{s.label}</div><div style="font-size:11px; color:var(--dim); font-family:var(--mono); margin-top:2px;">{fmtDate(s.date)}</div></div>
            <span class="num" style="margin-right:8px; font-size:13px;">RM {fmt(s.amount)}</span>
            <button class="icon-btn small" aria-label="Edit" onclick={() => startEditPersonalSpend(s)}>
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </button>
            <button class="icon-btn small" aria-label="Delete" onclick={() => deletePersonalSpend(s)}>
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        {/if}
      {:else}
        <p class="hint" style="margin:2px 0;">Nothing pulled from savings yet.</p>
      {/each}
    </div>
  </div>
</div>

<style>
  .goal-card { margin-bottom: 10px; cursor: pointer; }
  .goal-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  .goal-name { display: flex; align-items: center; gap: 8px; font-size: 14.5px; font-weight: 700; }
  .goal-nums { font-family: var(--mono); font-size: 12.5px; color: var(--lo); white-space: nowrap; }
  .goal-nums b { color: var(--hi); font-weight: 600; }
  .goal-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
  .goal-state { font-size: 11.5px; font-family: var(--mono); color: var(--dim); }
  .goal-state.done { color: var(--good); font-family: var(--body); font-weight: 700; }
  .goal-action { background: none; border: 1px solid var(--stroke-2); border-radius: 10px; padding: 6px 12px; font-size: 12px; font-weight: 700; color: var(--gold); font-family: var(--body); }
  .goal-card.reached { border-color: rgba(74, 222, 128, 0.4); }
  .goal-card.closed { opacity: 0.55; }
  .goal-card.closed .goal-name { color: var(--lo); }

  .new-goal-btn { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; margin-top: 12px; padding: 13px 0; border: 1px dashed var(--stroke-2); border-radius: 14px; color: var(--gold); font-size: 13px; font-weight: 700; background: none; }

  .pool-actions { display: flex; gap: 8px; margin-top: 16px; position: relative; z-index: 1; }
  .pool-actions button { flex: 1; padding: 11px 0; border-radius: 12px; font-size: 12.5px; font-weight: 700; font-family: var(--body); border: 1px solid var(--stroke-2); }
  .pool-actions .primary { background: var(--gold); color: #241a05; border-color: var(--gold); }
  .pool-actions .ghost { background: rgba(255, 255, 255, 0.05); color: var(--hi); }

  .nav-rows { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
  .nav-row { display: flex; align-items: center; justify-content: space-between; width: 100%; background: var(--panel); border: 1px solid var(--stroke); border-radius: 16px; padding: 15px 16px; color: var(--hi); font-size: 14px; font-weight: 700; font-family: var(--body); }
  .nav-row .nav-meta { display: flex; align-items: center; gap: 10px; color: var(--dim); font-family: var(--mono); font-size: 13px; font-weight: 600; }

  .type-row { display: flex; flex-direction: column; gap: 8px; }
  .type-opt { text-align: left; background: var(--panel); border: 1px solid var(--stroke-2); border-radius: 14px; padding: 12px 14px; color: var(--hi); font-family: var(--body); }
  .type-opt.sel { border-color: var(--gold); box-shadow: inset 0 0 0 1px var(--gold); }
  .type-opt .type-t { font-size: 14px; font-weight: 700; }
  .type-opt .type-d { font-size: 11.5px; color: var(--lo); margin-top: 3px; line-height: 1.4; }

  .rate-line { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 14px; color: var(--hi); font-weight: 600; }
  .rate-line .note-input { width: 110px; padding: 10px 12px; }
  .rate-line .lo { color: var(--lo); font-weight: 600; }

  .color-row { display: flex; gap: 10px; margin-top: 2px; flex-wrap: wrap; }
  .color-dot { width: 32px; height: 32px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
  .color-dot.sel { border-color: var(--hi); }

  .dividend-list { position: relative; z-index: 1; margin-top: 12px; }
  .dividend-row { display: flex; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--stroke); }
  .dividend-row:last-child { border-bottom: none; }
  .dividend-label { flex: 1; font-size: 13px; color: var(--hi); }
  .icon-btn.small { width: 28px; height: 28px; }
  .dividend-edit { padding: 8px 0; border-bottom: 1px solid var(--stroke); }
  .dividend-edit .note-input { margin-bottom: 8px; }
</style>
