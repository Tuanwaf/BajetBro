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

  let cardPlacement = $derived.by(() => {
    if (!rect) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    const viewportH = window.innerHeight;
    const spaceBelow = viewportH - (rect.top + rect.height);
    const spaceAbove = rect.top;
    if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
      return { top: `${rect.top + rect.height + 14}px`, left: '20px', right: '20px' };
    }
    return { top: `${Math.max(14, rect.top - 14)}px`, left: '20px', right: '20px', transform: 'translateY(-100%)' };
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

    <div class="guide-card" style="top:{cardPlacement.top}; left:{cardPlacement.left}; right:{cardPlacement.right}; transform:{cardPlacement.transform ?? 'none'};">
      <div class="guide-progress">Step {$tourStepIndex + 1} of {total}</div>
      <div class="guide-title">{step.title}</div>
      <p class="guide-body">{step.body}</p>
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
    border-radius: 16px;
    box-shadow: 0 0 0 4px rgba(231, 179, 78, 0.18), 0 0 24px rgba(231, 179, 78, 0.35);
    transition: top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease;
  }
  .guide-card {
    position: absolute;
    pointer-events: auto;
    background: var(--panel, #1b1f2a);
    border: 1px solid var(--stroke-2, #333a4a);
    border-radius: 18px;
    padding: 16px 18px;
    max-width: 380px;
    margin: 0 auto;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }
  .guide-progress { font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase; color: var(--gold); }
  .guide-title { font-size: 16px; font-weight: 700; color: var(--hi, #fff); margin-top: 4px; }
  .guide-body { font-size: 13px; color: var(--lo, #b7bccb); line-height: 1.5; margin: 8px 0 14px; }
  .guide-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .guide-actions-right { display: flex; align-items: center; gap: 8px; }
  .guide-skip { background: none; border: none; color: var(--dim, #7d8494); font-size: 12.5px; font-weight: 600; padding: 6px 2px; }
  .guide-back {
    width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--stroke-2, #333a4a);
    background: none; color: var(--hi, #fff); display: flex; align-items: center; justify-content: center;
  }
  .guide-next {
    background: var(--gold); color: #241a05; border: none; border-radius: 99px;
    padding: 9px 20px; font-size: 13px; font-weight: 700;
  }
  .guide-hint { font-size: 12px; font-weight: 700; color: var(--gold); }
</style>
