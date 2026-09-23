<script>
  import { onDestroy, onMount, tick } from 'svelte';
  import { get } from 'svelte/store';
  import { celebration, celebrating, cardBuddyEl, landed, lastSetupMs, TIERS, tierIndex } from '../streak.js';

  const BIG = new Set(['start', 'milestone', 'tierup', 'revive', 'freeze']);
  const FREEZE_BLUE = '#3a8dde';

  // Mirrors streakScene.js's BUDDY_CENTER_Y / buddyPx() -- duplicated rather
  // than imported so this component doesn't pull three.js into the main
  // bundle just for two numbers.
  const BUDDY_CENTER_Y = 0.36;
  const buddyPx = (W, H) => Math.min(W * 0.6, H * 0.34, 300);

  let active = $state(null); // the celebration being played
  let canvasEl = $state(null);
  let fallback = $state(false);
  let shown = $state(false);
  let textOn = $state(false);
  let exiting = $state(false);
  let shownCount = $state(0);
  let run = null;
  let fallbackResolve = null;

  let fromTier = $derived(active ? TIERS[tierIndex(active.kind === 'tierup' ? active.before.count : active.after.count)] : null);
  let toTier = $derived(active ? TIERS[tierIndex(active.after.count)] : null);
  let textTop = $derived(typeof window === 'undefined' ? 0 : window.innerHeight * BUDDY_CENTER_Y + buddyPx(window.innerWidth, window.innerHeight) / 2 + 22);
  let fallbackSize = $derived(typeof window === 'undefined' ? 0 : buddyPx(window.innerWidth, window.innerHeight));

  let copy = $derived.by(() => {
    if (!active) return null;
    const n = active.after.count;
    switch (active.kind) {
      case 'start':
        return { kicker: 'Streak started', unit: n === 1 ? 'day streak' : 'day streak', sub: 'Log something every day to grow your buddy.' };
      case 'tierup':
        return { kicker: 'New buddy unlocked', unit: 'day streak!', sub: `Meet ${toTier.name} — your buddy evolved!` };
      case 'freeze': {
        const used = active.freezesUsed ?? 1;
        const left = active.after.freezes;
        return {
          kicker: used > 1 ? `${used} streak freezes used` : 'Streak freeze used',
          unit: 'day streak is safe!',
          sub: `${used > 1 ? 'Freezes covered the days' : 'A freeze covered the day'} you missed. ${left === 0 ? 'No freezes left — log daily to earn more.' : `${left} freeze${left === 1 ? '' : 's'} left.`}`,
        };
      }
      case 'revive':
        return { kicker: 'Streak relit', unit: 'day streak is back!', sub: "Welcome back — don't let it go grey again." };
      default:
        return { kicker: 'Milestone', unit: 'day streak!', sub: "You're on fire — keep it going." };
    }
  });

  function countUp(from, to) {
    const start = performance.now();
    const dur = Math.min(900, 250 + Math.abs(to - from) * 120);
    const stepFn = (now) => {
      const k = Math.min(1, (now - start) / dur);
      shownCount = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1 && active) requestAnimationFrame(stepFn);
    };
    requestAnimationFrame(stepFn);
  }

  function onPhase(name, ms) {
    if (name === 'ready') {
      lastSetupMs.set(ms);
      shown = true;
    } else if (name === 'text') {
      textOn = true;
      countUp(active.before.count, active.after.count);
    } else if (name === 'exit') {
      exiting = true;
    }
  }

  async function play(c) {
    active = c;
    fallback = false;
    textOn = false;
    exiting = false;
    shownCount = c.before.count;
    celebrating.set(true);
    await tick();

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    try {
      if (reduced) throw new Error('reduced motion');
      const { runCelebration } = await import('../streakScene.js');
      run = await runCelebration({
        canvas: canvasEl,
        kind: c.kind,
        fromImg: fromTier.img,
        toImg: toTier.img,
        color: c.kind === 'freeze' ? FREEZE_BLUE : toTier.color,
        getTarget: () => get(cardBuddyEl)?.getBoundingClientRect() ?? null,
        onPhase,
      });
      await run.done;
    } catch (e) {
      if (!reduced) console.warn('[BajetBro] streak celebration fell back to static:', e);
      // No 3D: a still buddy + the same text, tap to close.
      run = null;
      fallback = true;
      shown = true;
      onPhase('text');
      await new Promise((r) => {
        fallbackResolve = r;
        setTimeout(r, 4000);
      });
      exiting = true;
      await new Promise((r) => setTimeout(r, 300));
    }
    finish(c);
  }

  function finish(c) {
    run = null;
    fallbackResolve = null;
    shown = false;
    active = null;
    celebrating.set(false);
    celebration.set(null);
    landed.set({ before: c.before, after: c.after, freezeEarned: c.freezeEarned });
  }

  function dismiss() {
    if (run) run.dismiss();
    else fallbackResolve?.();
  }

  // Warm everything up quietly once the app is idle, so the first
  // celebration doesn't wait on downloading/parsing three.js or decoding the
  // buddy images. Both are cached after this; nothing is kept on the GPU.
  onMount(() => {
    const warm = () => {
      import('../streakScene.js').catch(() => {});
      for (const t of TIERS) {
        const img = new Image();
        img.src = t.img;
        img.decode?.().catch(() => {});
      }
    };
    if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 4000 });
    else setTimeout(warm, 2000);
  });

  const unsub = celebration.subscribe((c) => {
    if (c && BIG.has(c.kind) && !active) play(c);
  });
  onDestroy(() => {
    unsub();
    run?.abort();
  });
</script>

{#if active}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="cel" class:shown class:exiting role="dialog" aria-label="Streak celebration" tabindex="-1" onclick={dismiss}>
    <div class="backdrop"></div>
    <canvas bind:this={canvasEl}></canvas>
    {#if fallback}
      <img class="static-buddy" src={toTier.img} alt="" style="width:{fallbackSize}px; top:{textTop - 22 - fallbackSize}px" />
    {/if}
    <div class="txt" class:on={textOn} style="top:{textTop}px; --tier:{active.kind === 'freeze' ? FREEZE_BLUE : toTier.color}">
      <div class="kicker">{copy.kicker}</div>
      <div class="big"><span class="num">{shownCount}</span></div>
      <div class="unit">{copy.unit}</div>
      <p class="sub">{copy.sub}</p>
      {#if active.freezeEarned}<p class="frz">❄️ +1 streak freeze earned</p>{/if}
    </div>
    <div class="hint" class:on={textOn}>Tap to continue</div>
  </div>
{/if}

<style>
  .cel { position: fixed; inset: 0; z-index: 200; }
  .backdrop {
    position: absolute; inset: 0;
    background: rgba(17, 19, 24, 0.78);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    opacity: 0;
    transition: opacity 0.28s ease;
  }
  .cel.shown .backdrop { opacity: 1; }
  .cel.exiting .backdrop { opacity: 0; transition-duration: 0.55s; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .static-buddy { position: absolute; left: 50%; transform: translateX(-50%); animation: static-in 0.4s cubic-bezier(0.3, 1.5, 0.5, 1); }
  @keyframes static-in { from { opacity: 0; transform: translateX(-50%) scale(0.85); } }

  .txt {
    position: absolute; left: 20px; right: 20px;
    text-align: center; color: #fff;
    opacity: 0; transform: translateY(14px);
    transition: opacity 0.35s ease, transform 0.45s cubic-bezier(0.25, 1.4, 0.5, 1);
    pointer-events: none;
  }
  .txt.on { opacity: 1; transform: none; }
  .cel.exiting .txt, .cel.exiting .hint { opacity: 0; transform: translateY(-8px); transition-duration: 0.3s; }
  .kicker {
    display: inline-block;
    font-family: var(--display); font-size: 12px; font-weight: 800;
    letter-spacing: 0.14em; text-transform: uppercase;
    padding: 5px 12px; border-radius: 99px;
    background: var(--tier); color: #fff;
    border: 2px solid #fff;
  }
  .big { font-family: var(--mono); font-size: 76px; font-weight: 700; line-height: 1; letter-spacing: -0.04em; margin-top: 10px; text-shadow: 0 4px 24px rgba(0, 0, 0, 0.35); }
  .unit { font-family: var(--display); font-size: 22px; font-weight: 800; margin-top: 2px; }
  .sub { font-size: 14px; color: rgba(255, 255, 255, 0.82); margin: 10px 0 0; line-height: 1.45; }
  .frz { font-size: 13px; color: #9fd0ff; font-weight: 700; margin: 8px 0 0; }
  .hint {
    position: absolute; left: 0; right: 0;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 34px);
    text-align: center; font-size: 12px; font-weight: 600; color: rgba(255, 255, 255, 0.55);
    opacity: 0; transition: opacity 0.4s ease 0.8s;
    pointer-events: none;
  }
  .hint.on { opacity: 1; }
</style>
