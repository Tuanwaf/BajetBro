<script>
  import { tourActive, tourStepIndex, TOUR_STEPS, nextStep, backStep, endTour } from '../tour.js';

  let step = $derived(TOUR_STEPS[$tourStepIndex]);
  let total = TOUR_STEPS.length;

  let rect = $state(null);
  let findAttempts = 0;
  let findTimer;
  let waitTimer;
  let resizeHandler;

  const PAD = 6;

  function measure() {
    if (!step) return;
    const el = document.querySelector(step.target);
    if (!el) {
      findAttempts++;
      if (findAttempts < 30) {
        clearTimeout(findTimer);
        findTimer = setTimeout(measure, 120);
      }
      return;
    }
    findAttempts = 0;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    // Let scroll settle a frame before measuring.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      rect = { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
    }));
  }

  $effect(() => {
    if (!$tourActive || !step) {
      rect = null;
      return;
    }
    findAttempts = 0;
    clearTimeout(findTimer);
    measure();

    if (step.kind === 'navigate' && step.waitFor) {
      clearInterval(waitTimer);
      waitTimer = setInterval(() => {
        if (step.waitFor()) {
          clearInterval(waitTimer);
          nextStep();
        }
      }, 150);
    }

    return () => {
      clearTimeout(findTimer);
      clearInterval(waitTimer);
    };
  });

  $effect(() => {
    if (!$tourActive) return;
    resizeHandler = () => measure();
    window.addEventListener('resize', resizeHandler);
    window.addEventListener('scroll', resizeHandler, true);
    return () => {
      window.removeEventListener('resize', resizeHandler);
      window.removeEventListener('scroll', resizeHandler, true);
    };
  });

  // Picks whichever side of the spotlight has more room, then hard-caps the
  // card's height to whatever that side actually has (with internal scroll as
  // a last resort). The old version only compared space-above vs space-below
  // and anchored via a fixed top + translateY(-100%) -- for a low-on-page
  // target with a long body (step 9 "Buffer", step 13 "Fixed categories"),
  // that let a tall card run off the bottom of the screen uncapped. Anchoring
  // the "above" case by `bottom` instead of `top+transform` means it can
  // never do that: it grows upward from a fixed point and stops at max-height.
  // EDGE reserves a floor of breathing room at whichever edge the card ends
  // up closest to -- without it, a tall spotlight (e.g. the whole Fixed
  // categories card) leaves so little room that the guide card's own edge
  // lands flush at y=0, right under the notch/status-bar overlay.
  const EDGE = 20;
  let cardPlacement = $derived.by(() => {
    if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', maxHeight: `calc(100vh - ${EDGE * 2}px)` };
    const viewportH = window.innerHeight;
    const margin = 14;
    const spaceBelow = viewportH - (rect.top + rect.height) - margin - EDGE;
    const spaceAbove = rect.top - margin - EDGE;
    if (spaceBelow >= spaceAbove) {
      return { top: `${rect.top + rect.height + margin}px`, left: '20px', right: '20px', maxHeight: `${Math.max(120, spaceBelow)}px` };
    }
    return { bottom: `${viewportH - rect.top + margin}px`, left: '20px', right: '20px', maxHeight: `${Math.max(120, spaceAbove)}px` };
  });
</script>

{#if $tourActive && step}
  <div class="guide-root">
    {#if rect}
      <div class="guide-dim" style="clip-path: polygon(
        0% 0%, 0% 100%, {rect.left}px 100%, {rect.left}px {rect.top}px,
        {rect.left + rect.width}px {rect.top}px, {rect.left + rect.width}px {rect.top + rect.height}px,
        {rect.left}px {rect.top + rect.height}px, {rect.left}px 100%,
        100% 100%, 100% 0%
      );"></div>
      <div class="guide-ring" style="top:{rect.top}px; left:{rect.left}px; width:{rect.width}px; height:{rect.height}px;"></div>
    {:else}
      <div class="guide-dim"></div>
    {/if}

    <div class="guide-card" style="top:{cardPlacement.top ?? 'auto'}; bottom:{cardPlacement.bottom ?? 'auto'}; left:{cardPlacement.left}; right:{cardPlacement.right}; max-height:{cardPlacement.maxHeight ?? 'none'}; transform:{cardPlacement.transform ?? 'none'};">
      <div class="guide-scroll">
        <div class="guide-progress">Step {$tourStepIndex + 1} of {total}</div>
        <div class="guide-title">{step.title}</div>
        <p class="guide-body">{step.body}</p>
      </div>
      <div class="guide-actions">
        <button class="guide-skip" onclick={() => endTour(true)}>Skip tour</button>
        <div class="guide-actions-right">
          {#if $tourStepIndex > 0}
            <button class="guide-back" onclick={backStep} aria-label="Back">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 1 3 7l6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          {/if}
          {#if step.kind !== 'navigate'}
            <button class="guide-next" onclick={nextStep}>{$tourStepIndex + 1 === total ? 'Done' : 'Next'}</button>
          {:else}
            <span class="guide-hint">Tap the highlighted spot →</span>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .guide-root { position: fixed; inset: 0; z-index: 20000; pointer-events: none; }
  .guide-dim { position: absolute; inset: 0; background: rgba(6, 7, 10, 0.78); transition: clip-path 0.25s ease; }
  .guide-ring {
    position: absolute;
    border: 2px solid var(--gold);
    border-radius: 18px;
    box-shadow: 0 0 0 4px var(--gold-dim);
    transition: top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease;
  }
  .guide-card {
    position: absolute;
    pointer-events: auto;
    background: var(--panel);
    border: 2px solid var(--stroke-2);
    border-radius: 20px;
    box-shadow: 5px 5px 0 var(--stroke-2);
    padding: 16px 18px;
    max-width: 380px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  /* Only this part scrolls when a long body doesn't fit the available
     height -- the actions row below (Skip/Back/Next) stays pinned and
     visible no matter what, instead of scrolling off with the text. */
  .guide-scroll { overflow-y: auto; min-height: 0; }
  .guide-progress { font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--gold); }
  .guide-title { font-size: 16px; font-weight: 700; color: var(--hi); margin-top: 4px; }
  .guide-body { font-size: 13px; color: var(--lo); line-height: 1.5; margin: 8px 0 14px; }
  .guide-actions { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding-top: 4px; }
  .guide-actions-right { display: flex; align-items: center; gap: 8px; }
  .guide-skip { background: none; border: none; color: var(--dim); font-size: 12.5px; font-weight: 600; padding: 6px 2px; }
  .guide-back {
    width: 32px; height: 32px; border-radius: 50%; border: 2px solid var(--stroke-2);
    box-shadow: 2px 2px 0 var(--stroke-2);
    background: none; color: var(--hi); display: flex; align-items: center; justify-content: center;
  }
  .guide-next {
    background: var(--gold); color: var(--accent-ink); border: 2px solid var(--stroke-2); border-radius: 99px;
    padding: 9px 20px; font-size: 13px; font-weight: 700;
  }
  .guide-hint { font-size: 12px; font-weight: 700; color: var(--gold); }
</style>
