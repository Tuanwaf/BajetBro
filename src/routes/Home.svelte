<script>
  import { currentMonth, userName, honorific, goals as goalsStore } from '../lib/stores.js';
  import {
    computeBufferActual,
    computeBankFreeTotal,
    computeBufferPlannedLive,
    computePlannedTotalLive,
    computeReimbursedTotal,
    allocIsReserved,
    spendRM,
    inCycle,
    round2,
  } from '../lib/calc.js';
  import { fmt, formatDate } from '../lib/format.js';
  import { BUFFER_COLOR, GOALS_ROW_COLOR } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { currentView } from '../lib/viewStore.js';
  import CategoryDetailSheet from './CategoryDetailSheet.svelte';
  import BufferDetailSheet from './BufferDetailSheet.svelte';
  import ReimbursementsSheet from './ReimbursementsSheet.svelte';
  import BankCarousel from '../lib/components/BankCarousel.svelte';
  import StreakCard from '../lib/components/StreakCard.svelte';
  import StreakSheet from './StreakSheet.svelte';
  import { streakSheetOpen } from '../lib/streak.js';
  import BankTransactionsSheet from './BankTransactionsSheet.svelte';
  import { banks as bankPreviewStore, focusedBankIndex } from '../lib/bankPreviewStore.js';

  let { onEndMonth } = $props();

  let month = $derived($currentMonth);

  // ---- multi-bank (see feature/multi-bank) -- the bank list itself is
  // real (db.banks), shared with Settings' "Manage banks" sheet and
  // OnboardingFlow via bankPreviewStore.js. Transaction-level bank tagging
  // isn't wired up yet -- each bank's own `transactions` here is still
  // just whatever was seeded/entered directly, not derived from real
  // expense entries. ----
  let bankPreview = $derived($bankPreviewStore);
  let activeBankIndex = $derived($focusedBankIndex);
  let activeBank = $derived(bankPreview[activeBankIndex] ?? bankPreview[0]);
  let bankTxnSheetOpen = $state(false);

  let year = $derived(month ? month.key.split('-')[0] : '');
  // The real, live "how much do I actually have" figure -- summed straight
  // from every bank's free-to-spend money, not the old single-pool
  // startingBalance chain (see computeBankFreeTotal's comment in calc.js).
  // Buffer/Commitments both anchor on this now, so a Transfer or a goal
  // contribution/withdrawal shows up in them immediately instead of
  // silently drifting away from reality.
  let liveTotal = $derived(computeBankFreeTotal(bankPreview));
  let bufferPlanned = $derived(month ? computeBufferPlannedLive(month, liveTotal) : 0);
  let bufferActual = $derived(month ? computeBufferActual(month) : 0);
  let plannedTotal = $derived(month ? computePlannedTotalLive(month, liveTotal) : 0);
  let reimbursedTotal = $derived(month ? computeReimbursedTotal(month) : 0);
  let reimburseOpen = $state(false);

  // Whether one goal allocation/spend (dated, not month-scoped like
  // categories) belongs to THIS cycle -- see calc.js's inCycle/cycleStartOf
  // (moved there once computeGoalGivenTotal needed the exact same cycle-
  // boundary logic for Monthly Log/End Month's own "Spent" figure).
  function inCurrentCycle(date, entryCycleMonth) {
    return inCycle(month, date, entryCycleMonth);
  }

  // What actually shrank Buffer's own pool this cycle, made visible --
  // liveTotal (feeding bufferPlanned above) drops the instant a goal
  // reserves money in a bank OR gives money away for good, but neither
  // ever showed up as a line item anywhere near Buffer. One combined row
  // per goal: reserved money is still yours (just locked away), given
  // money is real spending -- shown together since a goal can do both in
  // the same cycle. Every OPEN goal is listed regardless of whether it had
  // activity this cycle (RM0 is still useful information -- "this goal
  // exists, nothing happened to it yet" -- not something to hide); closed
  // goals are the only ones left out.
  let goalList = $derived($goalsStore ?? []);
  let goalActivity = $derived.by(() => {
    if (!month) return [];
    return goalList
      .filter((g) => !g.closed)
      .map((g) => {
        let reserved = 0;
        let given = 0;
        for (const a of g.allocations || []) {
          // A `starting` allocation is what the goal already had before it
          // was ever tracked -- not something that happened this cycle,
          // even when it's dated/cycleMonth-tagged as the current one (a
          // goal created today with a starting balance would otherwise
          // show up here as if you'd just contributed it).
          if (a.starting) continue;
          if (!inCurrentCycle(a.date, a.cycleMonth)) continue;
          if (allocIsReserved(g, a)) reserved = round2(reserved + (a.amount || 0));
          else given = round2(given + (a.amount || 0));
        }
        for (const s of g.spends || []) {
          if (!inCurrentCycle(s.date, s.cycleMonth)) continue;
          given = round2(given + spendRM(g, s));
        }
        return { id: g.id, label: g.label, color: g.color, reserved, given };
      });
  });
  function goalNote(g) {
    const parts = [];
    if (g.reserved > 0.005) parts.push(`Reserved RM ${fmt(g.reserved)}`);
    if (g.given > 0.005) parts.push(`Given RM ${fmt(g.given)}`);
    return parts.length ? parts.join(' · ') : 'No activity yet';
  }
  // Same shape as the Buffer row's own total -- one number for the
  // collapsed row, expands (goalsOpen) to the per-goal breakdown below it,
  // exactly like bufferGroups/.buffer-sub already does.
  let goalsTotal = $derived(round2(goalActivity.reduce((s, g) => s + g.reserved + g.given, 0)));
  let goalsOpen = $state(false);

  let bufferOpen = $state(false);
  let bufferLabel = $state(null);
  let bufferInfo = $derived(rowInfo({ actual: bufferActual, planned: bufferPlanned }));
  // Collapse buffer extras that share a label into one line (summed); the
  // individual entries stay viewable/editable in the BufferDetailSheet.
  let bufferGroups = $derived.by(() => {
    const map = new Map();
    for (const e of month?.extras || []) map.set(e.name, round2((map.get(e.name) || 0) + (e.actual || 0)));
    return [...map.entries()].map(([name, total]) => ({ name, total }));
  });
  let detailCategoryKey = $state(null);
  let detailCategory = $derived(detailCategoryKey ? month?.categories.find((c) => c.key === detailCategoryKey) : null);

  // Whichever of these four .sheet-page screens (see app.css) is open,
  // Home's own real content needs to be display:none rather than just
  // visually covered -- these now share the root document scroll instead
  // of being position:fixed overlays with their own scroller.
  // "Hi Bro Wafiq" / "Hi Sis Siti" / "Hi Wafiq" -- Bro/Sis is set in
  // Settings -> Profile. "Hi there" if there's no name at all.
  let greeting = $derived(
    'Hi ' + ([$honorific === 'bro' ? 'Bro' : $honorific === 'sis' ? 'Sis' : '', $userName].filter(Boolean).join(' ') || 'there')
  );

  let anySheetOpen = $derived(detailCategoryKey != null || bufferLabel != null || reimburseOpen || bankTxnSheetOpen || $streakSheetOpen);
  $effect(() => {
    anySheetOpen;
    window.scrollTo(0, 0);
  });

  function rowInfo(cat) {
    const pct = cat.planned > 0 ? Math.min(100, Math.round((cat.actual / cat.planned) * 100)) : cat.actual > 0 ? 100 : 0;
    const over = cat.actual > cat.planned;
    return { pct, over };
  }

  async function toggleLock(catKey) {
    const categories = month.categories.map((c) => {
      if (c.key !== catKey) return c;
      if (c.locked) {
        return { ...c, locked: false };
      }
      const leftover = round2(c.planned - c.actual);
      return { ...c, locked: true, lockedLeftover: leftover };
    });
    await db.months.update(month.key, { categories });
  }
</script>

<div style:display={anySheetOpen ? 'none' : 'contents'}>
<div class="greet-row">
  <h2 class="title">{greeting} 👋</h2>
  <span class="pill gold cycle-pill">{month.label} {year}</span>
</div>

  {#if activeBank}
    <div data-guide="balance-remaining balance-stats">
      <BankCarousel banks={bankPreview} activeIndex={activeBankIndex} onNavigate={(i) => focusedBankIndex.set(i)} />
    </div>
  {/if}

  <!-- Balance first (it's why the app gets opened), streak right under it --
       still above the fold at its compact height. -->
  <div class="streak-slot"><StreakCard onOpen={() => streakSheetOpen.set(true)} /></div>

  {#if activeBank}

    <div class="section-hd">
      <h3>Recent · {activeBank.bank.name}</h3>
      <button class="see-all-btn" onclick={() => (bankTxnSheetOpen = true)}>
        See all
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <div class="card">
      {#each activeBank.transactions.slice(0, 2) as t}
        <div class="recent-txn-row" onclick={() => (bankTxnSheetOpen = true)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (bankTxnSheetOpen = true)}>
          <span class="dot" style="background:{t.color}"></span>
          <div class="recent-txn-body">
            <span class="recent-txn-note">{t.note}</span>
            <span class="recent-txn-date">{formatDate(t.date)}</span>
          </div>
          <span class="recent-txn-amt" style="color:{t.income ? 'var(--good)' : 'var(--red)'};">{t.income ? '+' : '−'}RM {fmt(t.amount)}</span>
        </div>
      {:else}
        <p class="hint" style="margin:2px 0;">No transactions yet on this bank.</p>
      {/each}
    </div>
  {/if}

  {#if reimbursedTotal > 0}
    <button class="paidback-row" onclick={() => (reimburseOpen = true)}>
      <span>Paid back to you</span>
      <span class="pb-meta">+RM {fmt(reimbursedTotal)}<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
    </button>
  {/if}

  <div class="section-hd" data-guide="commitments-section">
    <h3>Commitments</h3>
    <span>Planned RM {fmt(plannedTotal)}</span>
  </div>
  <div class="card">
    {#each month.categories as cat (cat.key)}
      {@const info = rowInfo(cat)}
      {@const leftover = cat.locked ? cat.lockedLeftover : null}
      <div class="cat-row" class:locked-row={cat.locked} onclick={() => (detailCategoryKey = cat.key)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (detailCategoryKey = cat.key)}>
        <span class="dot" style="background:{cat.color}"></span>
        <div class="cat-body">
          <div class="cat-name-row">
            <span>{cat.name}</span>
            <span class="cat-amt"><b class="num">RM {fmt(cat.actual)}</b> / {fmt(cat.planned)}</span>
          </div>
          <div class="track"><div class="fill" style="width:{info.pct}%; background:{info.over ? 'var(--red)' : cat.color}"></div></div>
          {#if cat.locked}
            <span class="cat-note" style="color:var(--gold);">
              Locked · {leftover >= 0 ? `RM ${fmt(leftover)} sent to Buffer` : `RM ${fmt(Math.abs(leftover))} pulled from Buffer`}
            </span>
          {:else}
            <span class="cat-note" class:over={info.over} class:under={!info.over}>
              {info.over ? `Over by RM ${fmt(cat.actual - cat.planned)}` : `RM ${fmt(cat.planned - cat.actual)} left`}
            </span>
          {/if}
        </div>
        <button class="lock-btn" aria-label={cat.locked ? 'Unlock category' : 'Lock category'} onclick={(e) => { e.stopPropagation(); toggleLock(cat.key); }}>
          {#if cat.locked}
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><rect x="5" y="11" width="14" height="9" rx="2" stroke="var(--gold)" stroke-width="1.6"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="var(--gold)" stroke-width="1.6" stroke-linecap="round"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><rect x="5" y="11" width="14" height="9" rx="2" stroke="var(--dim)" stroke-width="1.6"/><path d="M8 11V8a4 4 0 0 1 7.5-2" stroke="var(--dim)" stroke-width="1.6" stroke-linecap="round"/></svg>
          {/if}
        </button>
      </div>
    {/each}

    <div class="cat-row" data-guide="buffer-row" onclick={() => (bufferOpen = !bufferOpen)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (bufferOpen = !bufferOpen)}>
      <span class="dot" style="background:{BUFFER_COLOR}"></span>
      <div class="cat-body">
        <div class="cat-name-row">
          <span>Buffer</span>
          <span class="cat-amt"><b class="num">RM {fmt(bufferActual)}</b> / {fmt(bufferPlanned)}</span>
        </div>
        <div class="track"><div class="fill" style="width:{bufferInfo.pct}%; background:{bufferInfo.over ? 'var(--red)' : BUFFER_COLOR}"></div></div>
        <span class="cat-note" class:over={bufferInfo.over} class:under={!bufferInfo.over}>
          {bufferInfo.over ? `Over by RM ${fmt(bufferActual - bufferPlanned)}` : `RM ${fmt(bufferPlanned - bufferActual)} left · auto from income`}
        </span>
        {#if bufferGroups.length}
          <div class="buffer-sub" class:open={bufferOpen}>
            {#each bufferGroups as g (g.name)}
              <div class="item item-link" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); bufferLabel = g.name; }} onkeydown={(e) => e.key === 'Enter' && (bufferLabel = g.name)}>
                <span>{g.name} &rsaquo;</span><b>RM {fmt(g.total)}</b>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    {#if goalActivity.length}
      <div class="cat-row" onclick={() => (goalsOpen = !goalsOpen)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (goalsOpen = !goalsOpen)}>
        <span class="dot" style="background:{GOALS_ROW_COLOR}"></span>
        <div class="cat-body">
          <div class="cat-name-row">
            <span>Goals</span>
            <span class="cat-amt"><b class="num">RM {fmt(goalsTotal)}</b></span>
          </div>
          <span class="cat-note">This cycle · tap to see each goal</span>
          <div class="buffer-sub" class:open={goalsOpen}>
            {#each goalActivity as g (g.id)}
              <div class="item item-link" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); currentView.set('goals'); }} onkeydown={(e) => e.key === 'Enter' && currentView.set('goals')}>
                <span>{g.label} &rsaquo;</span><b>{goalNote(g)}</b>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>

  <button class="end-month-btn" onclick={onEndMonth}>
    <svg viewBox="0 0 24 24" fill="none"><path d="M5 21V4M5 4h11l-2 4 2 4H5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
    End {month.label} &amp; start next month
  </button>
</div>

<CategoryDetailSheet open={detailCategoryKey != null} category={detailCategory} onClose={() => (detailCategoryKey = null)} />
<BufferDetailSheet open={bufferLabel != null} label={bufferLabel} onClose={() => (bufferLabel = null)} />
<ReimbursementsSheet open={reimburseOpen} onClose={() => (reimburseOpen = false)} />
<StreakSheet open={$streakSheetOpen} onClose={() => streakSheetOpen.set(false)} />
<BankTransactionsSheet open={bankTxnSheetOpen} bank={activeBank?.bank} transactions={activeBank?.transactions ?? []} onClose={() => (bankTxnSheetOpen = false)} />

<style>
  .greet-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin: 14px 0 14px;
  }
  /* Mixed case and a little smaller than the app-wide uppercase title, per
     the Home mockup ("Hi Bro Wafiq" rather than "HI BRO WAFIQ"). */
  .streak-slot { margin-top: 14px; }
  .greet-row h2.title { margin: 0; font-size: 24px; line-height: 1.15; text-transform: none; }
  .cycle-pill {
    flex-shrink: 0;
    white-space: nowrap;
    border: none;
    font-weight: 800;
    padding: 8px 12px;
  }
  .see-all-btn {
    display: flex;
    align-items: center;
    gap: 2px;
    background: none;
    border: none;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: var(--dim);
    padding: 2px;
  }
  .recent-txn-row { display: flex; align-items: center; gap: 10px; padding: 9px 4px; border-bottom: 1px solid var(--stroke); cursor: pointer; }
  .recent-txn-row:last-child { border-bottom: none; }
  .recent-txn-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .recent-txn-note { font-size: 12.5px; font-weight: 600; color: var(--hi); }
  .recent-txn-date { font-size: 10.5px; color: var(--dim); }
  .recent-txn-amt { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 12.5px; font-weight: 700; flex-shrink: 0; }
  .lock-btn {
    background: none;
    border: none;
    padding: 4px;
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: 2px;
  }
  .lock-btn svg {
    transition: transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .lock-btn:active svg {
    transform: scale(0.82);
  }
  .cat-row {
    transition: opacity 0.3s ease;
  }
  .locked-row {
    opacity: 0.85;
  }
  .item-link {
    cursor: pointer;
  }
  .item-link span {
    color: var(--gold);
  }
  .paidback-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: var(--panel);
    border: 2px solid var(--good);
    border-radius: 16px;
    box-shadow: 3px 3px 0 var(--good);
    padding: 14px 16px;
    margin-top: 16px;
    margin-bottom: 16px;
    color: var(--hi);
    font-size: 14px;
    font-weight: 700;
    font-family: var(--body);
  }
  .paidback-row .pb-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--good);
    font-family: var(--mono);
    font-size: 14px;
    font-weight: 700;
  }
</style>
