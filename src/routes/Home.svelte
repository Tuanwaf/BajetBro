<script>
  import { currentMonth, template, hutangPots, tabungHaji, dividends, goals, savingsSpends } from '../lib/stores.js';
  import {
    computeAdhocPlanned,
    computeAdhocActual,
    computeSpentTotal,
    computeTotalRemaining,
    computeTotalBalance,
    computeTabungHajiTotal2,
    computePlannedTotal,
    round2,
  } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { ADHOC_COLOR } from '../lib/constants.js';
  import { currentView } from '../lib/viewStore.js';
  import db from '../lib/db.js';
  import CategoryDetailSheet from './CategoryDetailSheet.svelte';
  import AdhocDetailSheet from './AdhocDetailSheet.svelte';

  let { onEndMonth } = $props();

  let month = $derived($currentMonth);
  let tmpl = $derived($template);
  let pots = $derived($hutangPots ?? []);
  let th = $derived($tabungHaji);
  let divs = $derived($dividends ?? []);
  let goalList = $derived($goals ?? []);
  let sSpends = $derived($savingsSpends ?? []);

  let year = $derived(month ? month.key.split('-')[0] : '');
  let adhocPlanned = $derived(month ? computeAdhocPlanned(month) : 0);
  let adhocActual = $derived(month ? computeAdhocActual(month) : 0);
  let spentTotal = $derived(month ? computeSpentTotal(month) : 0);
  let totalRemaining = $derived(month ? computeTotalRemaining(month) : 0);
  let totalBalance = $derived(month ? computeTotalBalance(month) : null);
  let plannedTotal = $derived(month ? computePlannedTotal(month) : 0);
  let tabungHajiTotal = $derived(th ? computeTabungHajiTotal2(th, pots, goalList, divs, sSpends) : 0);

  let adhocOpen = $state(false);
  let adhocLabel = $state(null);
  let adhocInfo = $derived(rowInfo({ actual: adhocActual, planned: adhocPlanned }));
  // Collapse ad-hoc extras that share a label into one line (summed); the
  // individual entries stay viewable/editable in the AdhocDetailSheet.
  let adhocGroups = $derived.by(() => {
    const map = new Map();
    for (const e of month?.extras || []) map.set(e.name, round2((map.get(e.name) || 0) + (e.actual || 0)));
    return [...map.entries()].map(([name, total]) => ({ name, total }));
  });
  let detailCategoryKey = $state(null);
  let detailCategory = $derived(detailCategoryKey ? month?.categories.find((c) => c.key === detailCategoryKey) : null);

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

{#if month && tmpl}
  <h2 class="title">Hey, Wafiq 👋</h2>
  <p class="sub">{month.label} {year}</p>

  <div class="balance-card">
    <div class="balance-top">
      <div class="lbl">Remaining this month</div>
      <span class="pill" class:good={totalRemaining >= 0} class:bad={totalRemaining < 0}>
        {totalRemaining >= 0 ? 'On track' : 'Over budget'}
      </span>
    </div>
    <div class="balance-amt"><span class="cur">RM</span>{fmt(totalRemaining)}</div>
    <div class="balance-row">
      <div class="stat">
        <div class="k">Income</div>
        <div class="v num">
          {totalBalance != null ? 'RM ' + fmt(totalBalance) : '—'}
          {#if month.additionalIncome > 0}<span style="color:var(--good); font-size:10.5px;"> +{fmt(month.additionalIncome)}</span>{/if}
        </div>
      </div>
      <div class="stat">
        <div class="k">Salary</div>
        <div class="v num">
          RM {fmt(month.income)}
          {#if month.bonus > 0}<span style="color:var(--good); font-size:10.5px;"> +{fmt(month.bonus)}</span>{/if}
        </div>
      </div>
      <div class="stat">
        <div class="k">Spent</div>
        <div class="v num" style="color:var(--red);">RM {fmt(spentTotal)}</div>
      </div>
    </div>
  </div>

  <div class="card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; cursor:pointer;" onclick={() => currentView.set('goals')} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('goals')}>
    <div>
      <div style="font-size:11.5px; color:var(--lo); font-weight:600;">Tabung Haji</div>
      <div class="num" style="font-size:19px; font-weight:700; margin-top:2px;">RM {fmt(tabungHajiTotal)}</div>
      <div style="font-size:11px; color:var(--dim); margin-top:2px;">Deposit + Savings + Dividend</div>
    </div>
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="color:var(--dim); flex-shrink:0;"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </div>

  <div class="section-hd">
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
              Locked · {leftover >= 0 ? `RM ${fmt(leftover)} sent to Ad-hoc` : `RM ${fmt(Math.abs(leftover))} pulled from Ad-hoc`}
            </span>
          {:else if cat.key === 'saving'}
            <span class="cat-note link" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); currentView.set('goals'); }} onkeydown={(e) => e.key === 'Enter' && currentView.set('goals')}>Feeds your Goals pool &rarr;</span>
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

    <div class="cat-row" onclick={() => (adhocOpen = !adhocOpen)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && (adhocOpen = !adhocOpen)}>
      <span class="dot" style="background:{ADHOC_COLOR}"></span>
      <div class="cat-body">
        <div class="cat-name-row">
          <span>Ad-hoc</span>
          <span class="cat-amt"><b class="num">RM {fmt(adhocActual)}</b> / {fmt(adhocPlanned)}</span>
        </div>
        <div class="track"><div class="fill" style="width:{adhocInfo.pct}%; background:{adhocInfo.over ? 'var(--red)' : ADHOC_COLOR}"></div></div>
        <span class="cat-note" class:over={adhocInfo.over} class:under={!adhocInfo.over}>
          {adhocInfo.over ? `Over by RM ${fmt(adhocActual - adhocPlanned)}` : `RM ${fmt(adhocPlanned - adhocActual)} left · auto from income`}
        </span>
        {#if adhocGroups.length}
          <div class="adhoc-sub" class:open={adhocOpen}>
            {#each adhocGroups as g (g.name)}
              <div class="item item-link" role="button" tabindex="0" onclick={(e) => { e.stopPropagation(); adhocLabel = g.name; }} onkeydown={(e) => e.key === 'Enter' && (adhocLabel = g.name)}>
                <span>{g.name} &rsaquo;</span><b>RM {fmt(g.total)}</b>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>

  <button class="end-month-btn" onclick={onEndMonth}>
    <svg viewBox="0 0 24 24" fill="none"><path d="M5 21V4M5 4h11l-2 4 2 4H5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
    End {month.label} &amp; start next month
  </button>
{:else}
  <p class="sub">Loading...</p>
{/if}

<CategoryDetailSheet open={detailCategoryKey != null} category={detailCategory} onClose={() => (detailCategoryKey = null)} />
<AdhocDetailSheet open={adhocLabel != null} label={adhocLabel} onClose={() => (adhocLabel = null)} />

<style>
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
</style>
