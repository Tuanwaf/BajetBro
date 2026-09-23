<script>
  import { sheetPageCount } from '../lib/viewStore.js';
  import { swipeBack } from '../lib/swipeBack.js';
  import { streak, effectiveDays, today, localDay, TIERS, GREY_PASTEL, tierIndex, REVIVE_DAYS, MAX_FREEZES, FREEZE_EVERY } from '../lib/streak.js';
  import StreakFlame from '../lib/components/StreakFlame.svelte';

  let { open, onClose } = $props();

  // See CategoryDetailSheet.svelte's comment -- .sheet-page, registers on
  // sheetPageCount, not openSheetCount.
  $effect(() => {
    if (!open) return;
    sheetPageCount.update((n) => n + 1);
    return () => sheetPageCount.update((n) => n - 1);
  });

  let s = $derived($streak);
  let grey = $derived(s.status === 'grey');
  let tIdx = $derived(tierIndex(s.count));
  let tier = $derived(TIERS[tIdx]);
  let next = $derived(TIERS[tIdx + 1] ?? null);

  let statusLabel = $derived(s.status === 'active' ? 'Active' : grey ? 'On hold' : s.best > 0 ? 'Ended' : 'Not started');
  let statusClass = $derived(s.status === 'active' ? 'good' : grey ? 'neutral' : 'bad');

  // Last 14 days, oldest first, split into two weeks of 7.
  let calendar = $derived.by(() => {
    const logged = new Set($effectiveDays);
    const frozen = new Set(s.frozenDays);
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setHours(12, 0, 0, 0);
      d.setDate(d.getDate() - i);
      const key = localDay(d);
      out.push({
        key,
        letter: d.toLocaleDateString('en', { weekday: 'narrow' }),
        date: d.getDate(),
        state: logged.has(key) ? 'logged' : frozen.has(key) ? 'frozen' : key === $today ? 'today' : 'missed',
        isToday: key === $today,
      });
    }
    return [out.slice(0, 7), out.slice(7)];
  });

  let heroMsg = $derived.by(() => {
    if (s.status === 'none') return s.best > 0 ? `Your best was ${s.best} days. Log today to start a new streak.` : 'Log your first entry to start a streak.';
    if (grey) {
      const left = REVIVE_DAYS - s.revive;
      return `On hold at ${s.count} days. Log ${left} more day${left === 1 ? '' : 's'} in a row to relight it — once you start, missing a day starts it over from 1.`;
    }
    if (!s.todayLogged) return 'Not logged yet today — save any entry to keep it alive.';
    if (next) {
      const left = next.min - s.count;
      return `${left} more day${left === 1 ? '' : 's'} until your buddy evolves.`;
    }
    return "You've reached the final buddy. Legend!";
  });
</script>

<div class="sheet-page" class:open use:swipeBack={onClose}>
  <div class="sheet-page-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>Streak</h2>
    <span style="width:38px;"></span>
  </div>

  <div class="sheet-page-body">
    <div class="card hero" class:grey style="--tier:{tier.color}; background:{grey || s.status === 'none' ? GREY_PASTEL : tier.pastel}">
      <div class="hero-buddy"><img src={tier.img} alt="{tier.name} buddy" draggable="false" /></div>
      <div class="hero-count">
        <StreakFlame size={26} tier={tIdx} grey={s.status !== 'active'} unlit={s.status === 'active' && !s.todayLogged} />
        <span class="n num">{s.count}</span>
        <span class="unit">{s.count === 1 ? 'day' : 'days'}</span>
      </div>
      <div class="hero-meta">
        <span class="pill {statusClass}">{statusLabel}</span>
        <span class="pill neutral">{tier.name}</span>
      </div>
      <p class="hero-msg">{heroMsg}</p>
      {#if grey}
        <div class="revive-dots">
          {#each Array(REVIVE_DAYS) as _, i}
            <span class="rdot" class:on={i < s.revive}></span>
          {/each}
        </div>
      {/if}
    </div>

    <div class="stats">
      <div class="card stat"><span class="lbl">Current</span><span class="v num">{s.count}</span></div>
      <div class="card stat"><span class="lbl">Best</span><span class="v num">{s.best}</span></div>
      <div class="card stat">
        <span class="lbl">Freezes</span>
        <span class="v num">{s.freezes}<span class="of">/{MAX_FREEZES}</span></span>
      </div>
    </div>

    <div class="field-lbl">Last 14 days</div>
    <div class="card cal">
      {#each calendar as week}
        <div class="week">
          {#each week as d (d.key)}
            <div class="day" class:is-today={d.isToday}>
              <span class="dl">{d.letter}</span>
              <span class="dot {d.state}">
                {#if d.state === 'logged'}
                  <StreakFlame size={16} tier={tIdx} grey={grey} animate={false} />
                {:else if d.state === 'frozen'}
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none"><path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
                {:else}
                  <span class="dn">{d.date}</span>
                {/if}
              </span>
            </div>
          {/each}
        </div>
      {/each}
      <div class="cal-legend">
        <span><StreakFlame size={12} tier={tIdx} animate={false} /> Logged</span>
        <span><i class="lg frozen"></i> Freeze used</span>
        <span><i class="lg missed"></i> Missed</span>
      </div>
    </div>

    <div class="field-lbl">Buddies</div>
    <div class="card ladder">
      {#each TIERS as t, i}
        {@const unlocked = s.best >= t.min}
        <div class="rung" class:current={i === tIdx && s.count > 0} class:locked={!unlocked}>
          <img src={t.img} alt="" draggable="false" />
          <div class="rung-body">
            <div class="rung-name">{unlocked ? t.name : '???'}</div>
            <div class="rung-range">{t.max === Infinity ? `${t.min}+ days` : `${t.min}–${t.max} days`}</div>
          </div>
          {#if i === tIdx && s.count > 0}
            <span class="pill gold">Now</span>
          {:else if !unlocked}
            <span class="rung-left">{t.min - s.count} to go</span>
          {/if}
        </div>
      {/each}
    </div>

    <div class="field-lbl">How it works</div>
    <div class="card rules">
      <p><b>Keep it alive:</b> save at least one entry every day. Backdated entries don't count for past days.</p>
      <p><b>Freezes:</b> every {FREEZE_EVERY} days in a row earns a ❄️ (hold up to {MAX_FREEZES}). Miss a day and one is used automatically.</p>
      <p><b>On hold:</b> miss a day with no freezes and your streak goes grey. Log {REVIVE_DAYS} days in a row to relight it — the {REVIVE_DAYS} days are added back.</p>
      <p><b>Reset:</b> miss another day while it's grey and the streak starts again from 1.</p>
    </div>
  </div>
</div>

<style>
  .hero { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 18px 18px 20px; margin-bottom: 14px; }
  .hero-buddy { width: 58%; max-width: 210px; animation: bob 3.2s ease-in-out infinite; }
  .hero-buddy img { width: 100%; display: block; transform-origin: 50% 100%; animation: breathe 3.2s ease-in-out infinite; user-select: none; -webkit-user-drag: none; }
  .hero-count { display: flex; align-items: baseline; gap: 6px; margin-top: 10px; }
  .hero-count :global(.flame) { align-self: center; }
  .hero-count .n { font-size: 48px; font-weight: 700; letter-spacing: -0.03em; line-height: 1; }
  .hero-count .unit { font-family: var(--display); font-size: 20px; font-weight: 800; }
  .hero-meta { display: flex; gap: 6px; margin-top: 10px; }
  .hero-msg { font-size: 13px; color: var(--lo); line-height: 1.45; margin: 10px 0 0; max-width: 300px; }
  .grey .hero-buddy img { filter: grayscale(1) brightness(1.08) contrast(0.85); opacity: 0.8; }
  .grey .hero-count .n, .grey .hero-count .unit { color: var(--dim); }
  .revive-dots { display: flex; gap: 6px; margin-top: 10px; }
  .rdot { width: 26px; height: 9px; border-radius: 99px; border: 1.5px solid var(--stroke-2); background: var(--panel); }
  .rdot.on { background: var(--gold); }
  @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
  @keyframes breathe { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.02, 0.98); } }

  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 4px; }
  .stat { display: flex; flex-direction: column; gap: 2px; padding: 12px; box-shadow: 3px 3px 0 var(--stroke-2); }
  .stat .lbl { font-size: 11px; font-weight: 700; color: var(--dim); text-transform: uppercase; letter-spacing: 0.06em; }
  .stat .v { font-size: 22px; font-weight: 700; }
  .stat .of { font-size: 13px; color: var(--dim); }

  .cal { display: flex; flex-direction: column; gap: 10px; padding: 14px 12px; }
  .week { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .day { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .dl { font-size: 10.5px; font-weight: 700; color: var(--dim); }
  .dot {
    width: 32px; height: 32px; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    border: 1.5px solid var(--stroke);
    font-size: 11px; color: var(--dim); font-family: var(--mono);
  }
  .dot.logged { background: var(--gold-dim); border-color: var(--gold); }
  .dot.frozen { background: rgba(58, 141, 222, 0.14); border-color: #3a8dde; color: #3a8dde; }
  .dot.today { border-style: dashed; border-color: var(--stroke-2); color: var(--hi); }
  .is-today .dl { color: var(--hi); }
  .cal-legend { display: flex; gap: 14px; justify-content: center; font-size: 11px; color: var(--dim); padding-top: 2px; }
  .cal-legend span { display: flex; align-items: center; gap: 4px; }
  .lg { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--stroke); display: inline-block; }
  .lg.frozen { background: rgba(58, 141, 222, 0.2); border-color: #3a8dde; }

  .ladder { display: flex; flex-direction: column; gap: 4px; padding: 8px 12px; }
  .rung { display: flex; align-items: center; gap: 12px; padding: 8px 6px; border-radius: 12px; }
  .rung.current { background: var(--panel-2); }
  .rung img { width: 46px; height: 46px; object-fit: contain; flex-shrink: 0; }
  .rung.locked img { filter: brightness(0); opacity: 0.18; }
  .rung-body { flex: 1; min-width: 0; }
  .rung-name { font-family: var(--display); font-size: 14px; font-weight: 800; }
  .rung.locked .rung-name { color: var(--dim); }
  .rung-range { font-size: 11.5px; color: var(--dim); margin-top: 1px; }
  .rung-left { font-size: 11px; color: var(--dim); font-weight: 600; white-space: nowrap; }

  .rules { padding: 14px 16px; }
  .rules p { font-size: 12.5px; color: var(--lo); line-height: 1.5; margin: 0 0 8px; }
  .rules p:last-child { margin-bottom: 0; }

  @media (prefers-reduced-motion: reduce) {
    .hero-buddy, .hero-buddy img { animation: none; }
  }
</style>
