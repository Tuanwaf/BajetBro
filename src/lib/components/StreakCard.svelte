<script>
  import { onDestroy } from 'svelte';
  import db from '../db.js';
  import { showToast } from '../toast.js';
  import { streak, streakReady, devDays, devSeenReset, celebration, celebrating, cardBuddyEl, landed, TIERS, GREY_PASTEL, tierIndex, REVIVE_DAYS } from '../streak.js';
  import StreakFlame from './StreakFlame.svelte';

  let { onOpen } = $props();

  // While a celebration is in flight the card keeps showing the state from
  // BEFORE the save, so the number rolls up only once the buddy has landed
  // back here (or straight away, for a plain daily bump).
  let hold = $state(null);
  let view = $derived(hold ?? $streak);
  let grey = $derived(view.status === 'grey');
  let active = $derived(view.status === 'active');
  // Active but nothing saved yet today: the buddy dozes and the flame waits
  // unlit until the first save wakes them both.
  let sleepy = $derived(active && !view.todayLogged);
  let tier = $derived(TIERS[tierIndex(view.count)]);
  let nextTier = $derived(TIERS[tierIndex(view.count) + 1] ?? null);

  let buddyEl = $state(null);
  $effect(() => {
    cardBuddyEl.set(buddyEl);
    return () => cardBuddyEl.set(null);
  });

  // ---- number roll + buddy reactions ----
  let rollFrom = $state(null);
  let reaction = $state(''); // '' | 'jelly' | 'hop'
  let reactKey = $state(0);
  let timers = [];
  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }
  onDestroy(() => timers.forEach(clearTimeout));

  function react(kind) {
    reaction = kind;
    reactKey++;
    later(() => (reaction = ''), 700);
  }
  function rollTo(from) {
    rollFrom = from;
    later(() => (rollFrom = null), 520);
  }

  const unsubCelebration = celebration.subscribe((c) => {
    if (!c) return;
    if (c.kind === 'bump' || c.kind === 'progress') {
      celebration.set(null);
      hold = null;
      if (c.kind === 'bump') rollTo(c.before.count);
      react(c.kind === 'bump' ? 'jelly' : 'hop');
      if (c.freezeEarned) later(() => showToast('❄️ Streak freeze earned — 7 days in a row!'), 900);
    } else {
      // Big moment -- StreakCelebration takes it from here.
      hold = c.before;
    }
  });
  const unsubLanded = landed.subscribe((l) => {
    if (!l) return;
    landed.set(null);
    hold = null;
    if (l.after.count !== l.before.count) rollTo(l.before.count);
    react('jelly');
    if (l.freezeEarned) later(() => showToast('❄️ Streak freeze earned — 7 days in a row!'), 900);
  });
  onDestroy(() => {
    unsubCelebration();
    unsubLanded();
  });

  // A freeze is spent silently on the day after a missed one -- the first
  // time the card sees a newly spent one (normally: opening the app the next
  // morning), it plays the freeze animation. The real count seen so far is
  // kept in db.meta; dev previews keep their own in memory, reset whenever
  // the panel jumps to a new state, so "Next day" in dev mode can trigger it.
  let devSeen = null;
  let lastReset = 0;
  function announceFreeze(n, s) {
    later(() => celebration.set({ kind: 'freeze', before: s, after: s, freezesUsed: n, freezeEarned: false }), 700);
  }
  $effect(() => {
    if (!$streakReady) return;
    const s = $streak;
    const reset = $devSeenReset;
    if ($devDays) {
      if (devSeen == null || reset !== lastReset) {
        devSeen = s.freezesUsed;
        lastReset = reset;
      } else if (s.freezesUsed > devSeen) {
        announceFreeze(s.freezesUsed - devSeen, s);
        devSeen = s.freezesUsed;
      }
      return;
    }
    devSeen = null;
    db.meta.get('streakFreezesSeen').then((rec) => {
      const seen = rec?.value ?? 0;
      if (!rec || s.freezesUsed < seen) {
        // First run (or a restored backup) -- just sync, nothing to show.
        db.meta.put({ key: 'streakFreezesSeen', value: s.freezesUsed });
      } else if (s.freezesUsed > seen) {
        db.meta.put({ key: 'streakFreezesSeen', value: s.freezesUsed });
        announceFreeze(s.freezesUsed - seen, s);
      }
    });
  });

  let message = $derived.by(() => {
    if (view.status === 'none') return view.best > 0 ? 'Streak ended · log today to start fresh' : 'Log an entry to start a streak';
    if (grey) {
      if (view.todayLogged) return 'Nice! Come back tomorrow';
      const left = REVIVE_DAYS - view.revive;
      return left === REVIVE_DAYS ? `On hold · log ${REVIVE_DAYS} days to relight` : `${left} more day${left === 1 ? '' : 's'} to relight!`;
    }
    if (!view.todayLogged) return 'Not logged yet today';
    if (nextTier && nextTier.min - view.count <= 5) {
      const left = nextTier.min - view.count;
      return `${left} day${left === 1 ? '' : 's'} to your next buddy!`;
    }
    return 'Keep it going!';
  });
</script>

<div class="card streak-card" class:grey class:sleepy style="background:{active ? tier.pastel : GREY_PASTEL}" role="button" tabindex="0" onclick={onOpen} onkeydown={(e) => e.key === 'Enter' && onOpen?.()}>
  <div class="buddy-wrap" class:hidden={$celebrating}>
    {#key reactKey}
      <div class="buddy-react {reaction}">
        <img class="buddy" bind:this={buddyEl} src={tier.img} alt="Streak buddy" draggable="false" />
      </div>
    {/key}
    {#if sleepy}
      <span class="zzz" aria-hidden="true"><i>z</i><i>z</i><i>z</i></span>
    {/if}
  </div>

  <div class="mid">
    <div class="line">
      <StreakFlame size={24} tier={tierIndex(view.count)} grey={!active} unlit={sleepy} />
      <span class="n num">
        {#if rollFrom != null}
          <span class="roll-out">{rollFrom}</span>
          <span class="roll-in">{view.count}</span>
        {:else}
          {view.count}
        {/if}
      </span>
      <span class="unit">day streak</span>
    </div>
    <p class="msg">{message}</p>
    {#if grey}
      <div class="revive-dots" aria-label="{view.revive} of {REVIVE_DAYS} days to relight">
        {#each Array(REVIVE_DAYS) as _, i}
          <span class="rdot" class:on={i < view.revive}></span>
        {/each}
      </div>
    {/if}
  </div>

  <span class="go" aria-hidden="true">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
  </span>
</div>

<style>
  .streak-card {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 0 0 16px;
    padding: 12px 14px 12px 12px;
    min-height: 104px;
    cursor: pointer;
  }
  .buddy-wrap { position: relative; width: 78px; flex-shrink: 0; display: flex; justify-content: center; animation: bob 3.2s ease-in-out infinite; }
  .buddy-wrap.hidden { visibility: hidden; }
  .buddy-react { width: 100%; display: flex; justify-content: center; transform-origin: 50% 100%; }
  .buddy { width: 100%; max-height: 84px; object-fit: contain; transform-origin: 50% 100%; animation: breathe 3.2s ease-in-out infinite; user-select: none; -webkit-user-drag: none; }
  .buddy-react.jelly { animation: jelly 0.7s cubic-bezier(0.3, 0.7, 0.4, 1); }
  .buddy-react.hop { animation: hop 0.6s cubic-bezier(0.3, 0.7, 0.4, 1); }
  @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
  @keyframes breathe { 0%, 100% { transform: scale(1, 1); } 50% { transform: scale(1.02, 0.98); } }
  @keyframes jelly {
    0% { transform: scale(1, 1); }
    18% { transform: scale(1.22, 0.8); }
    36% { transform: scale(0.88, 1.14); }
    54% { transform: scale(1.07, 0.95); }
    72% { transform: scale(0.97, 1.03); }
    100% { transform: scale(1, 1); }
  }
  @keyframes hop {
    0% { transform: translateY(0) scale(1, 1); }
    20% { transform: translateY(0) scale(1.1, 0.9); }
    45% { transform: translateY(-10px) scale(0.95, 1.06); }
    70% { transform: translateY(0) scale(1.08, 0.93); }
    100% { transform: translateY(0) scale(1, 1); }
  }

  .mid { flex: 1; min-width: 0; }
  /* wrap: a 4-digit streak pushes "day streak" onto its own line rather
     than squeezing the number. */
  .line { display: flex; align-items: center; flex-wrap: wrap; column-gap: 5px; }
  .n {
    position: relative;
    display: inline-block;
    flex-shrink: 0; /* overflow:hidden (for the roll) would otherwise let it shrink and clip digits */
    overflow: hidden;
    font-size: 25px; font-weight: 700; line-height: 1.15;
    letter-spacing: -0.03em;
    color: var(--hi);
  }
  .unit { font-family: var(--display); font-size: 17px; font-weight: 800; white-space: nowrap; }
  .roll-out, .roll-in { display: inline-block; }
  .roll-out { position: absolute; left: 0; top: 0; animation: roll-out 0.45s cubic-bezier(0.5, 0, 0.75, 0) forwards; }
  .roll-in { animation: roll-in 0.5s cubic-bezier(0.25, 1.4, 0.5, 1) both; }
  @keyframes roll-out { to { transform: translateY(-100%); opacity: 0; } }
  @keyframes roll-in { from { transform: translateY(100%); opacity: 0; } }
  .msg { font-size: 12.5px; color: var(--lo); margin: 2px 0 0; line-height: 1.35; }

  .revive-dots { display: flex; gap: 6px; margin-top: 7px; }
  .rdot { width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--stroke-2); background: var(--panel); }
  .rdot.on { background: var(--gold); animation: dot-pop 0.4s cubic-bezier(0.3, 1.6, 0.5, 1); }
  @keyframes dot-pop { 0% { transform: scale(0.6); } 100% { transform: scale(1); } }

  .go {
    width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
    display: flex; align-items: center; justify-content: center;
    background: var(--panel); border: 2px solid var(--stroke-2); color: var(--hi);
  }

  /* Grey: the streak is on hold -- buddy desaturated, number muted. */
  .grey .buddy { filter: grayscale(1) brightness(1.08) contrast(0.85); opacity: 0.8; }
  .grey .buddy-wrap { animation-duration: 5s; }
  .grey .n, .grey .unit { color: var(--dim); }

  /* Sleepy: not logged yet today -- buddy dimmed, dozing slowly, Zs drifting up. */
  .sleepy .buddy { filter: saturate(0.55) brightness(0.96); opacity: 0.85; animation-duration: 5.5s; }
  .sleepy .buddy-wrap { animation-duration: 5.5s; }
  .zzz { position: absolute; top: -2px; right: -4px; pointer-events: none; }
  .zzz i {
    position: absolute; right: 0; top: 0;
    font-family: var(--display); font-style: normal; font-weight: 800;
    color: var(--lo); opacity: 0;
    animation: zzz 3.6s ease-out infinite;
  }
  .zzz i:nth-child(1) { font-size: 11px; }
  .zzz i:nth-child(2) { font-size: 14px; animation-delay: 1.2s; }
  .zzz i:nth-child(3) { font-size: 17px; animation-delay: 2.4s; }
  @keyframes zzz {
    0% { transform: translate(0, 10px); opacity: 0; }
    20% { opacity: 0.85; }
    100% { transform: translate(10px, -16px) rotate(12deg); opacity: 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .buddy-wrap, .buddy, .buddy-react, .zzz i { animation: none !important; }
    .zzz i:nth-child(3) { opacity: 0.7; }
  }
</style>
