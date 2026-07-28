<script>
  import { currentMonth, template, hutangPots, tabungHaji, dividends } from '../lib/stores.js';
  import {
    computeAdhocPlanned,
    computeAdhocActual,
    computeSpentTotal,
    computeRemaining,
    computeRollsToNext,
    computeTabungHajiTotal,
    computePlannedTotal,
    round2,
  } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { ADHOC_COLOR, MONTH_NAMES } from '../lib/constants.js';
  import { currentView } from '../lib/viewStore.js';
  import db from '../lib/db.js';

  let { onEndMonth } = $props();

  let month = $derived($currentMonth);
  let tmpl = $derived($template);
  let pots = $derived($hutangPots ?? []);
  let th = $derived($tabungHaji);
  let divs = $derived($dividends ?? []);

  let year = $derived(month ? month.key.split('-')[0] : '');
  let adhocPlanned = $derived(month ? computeAdhocPlanned(month) : 0);
  let adhocActual = $derived(month ? computeAdhocActual(month) : 0);
  let spentTotal = $derived(month ? computeSpentTotal(month) : 0);
  let remaining = $derived(month ? computeRemaining(month) : 0);
  let rollsToNext = $derived(month ? computeRollsToNext(month) : null);
  let plannedTotal = $derived(month ? computePlannedTotal(month) : 0);
  let tabungHajiTotal = $derived(th ? computeTabungHajiTotal(th, pots, divs) : 0);

  let nextMonthAbbrev = $derived(month ? MONTH_NAMES[month.order % 12].slice(0, 3) : '');

  let adhocOpen = $state(false);
  let adhocInfo = $derived(rowInfo({ actual: adhocActual, planned: adhocPlanned }));

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
      <span class="pill" class:good={remaining >= 0} class:bad={remaining < 0}>
        {remaining >= 0 ? 'On track' : 'Over budget'}
      </span>
    </div>
    <div class="balance-amt"><span class="cur">RM</span>{fmt(remaining)}</div>
    <div class="balance-row">
      <div class="stat">
        <div class="k">Net income</div>
        <div class="v num">
          RM {fmt(month.income)}
          {#if month.bonus > 0}<span style="color:var(--good); font-size:10.5px;"> +{fmt(month.bonus)}</span>{/if}
        </div>
      </div>
      <div class="stat">
        <div class="k">Spent</div>
        <div class="v num">RM {fmt(spentTotal)}</div>
      </div>
      <div class="stat">
        <div class="k">Rolls to {nextMonthAbbrev}</div>
        <div class="v num" class:up={rollsToNext >= 0} class:down={rollsToNext < 0}>
          {rollsToNext != null ? 'RM ' + fmt(rollsToNext) : '—'}
        </div>
      </div>
    </div>
  </div>

  <div class="card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; cursor:pointer;" onclick={() => currentView.set('hutang')} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && currentView.set('hutang')}>
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
      <div class="cat-row" class:locked-row={cat.locked}>
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
            <span class="cat-note link" role="button" tabindex="0" onclick={() => currentView.set('hutang')} onkeydown={(e) => e.key === 'Enter' && currentView.set('hutang')}>Feeds your Hutang pot &rarr;</span>
          {:else}
            <span class="cat-note" class:over={info.over} class:under={!info.over}>
              {info.over ? `Over by RM ${fmt(cat.actual - cat.planned)}` : `RM ${fmt(cat.planned - cat.actual)} left`}
            </span>
          {/if}
        </div>
        <button class="lock-btn" aria-label={cat.locked ? 'Unlock category' : 'Lock category'} onclick={() => toggleLock(cat.key)}>
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
        {#if month.extras?.length}
          <div class="adhoc-sub" class:open={adhocOpen}>
            {#each month.extras as extra}
              <div class="item"><span>{extra.name}</span><b>RM {fmt(extra.actual)}</b></div>
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

<style>
  .lock-btn {
    background: none;
    border: none;
    padding: 4px;
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: 2px;
  }
  .locked-row {
    opacity: 0.85;
  }
</style>
