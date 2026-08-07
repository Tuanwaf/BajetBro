<script>
  import { tourActive, tourStepIndex, TOUR_STEPS, nextStep, backStep, endTour } from '../tour.js';

  let step = $derived(TOUR_STEPS[$tourStepIndex]);
  let total = TOUR_STEPS.length;

  let rect = $state(null);
  // Whether the spotlight hole should actually pass clicks through to the
  // real element underneath -- true for 'navigate' steps (the user must tap
  // the target) and for text inputs (the onboarding steps double as a form,
  // typed into live). Every other 'info' step is purely narration, so its
  // hole is visually cut but still click-blocked -- see .guide-hole-block.
  let interactive = $state(false);
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
    interactive = step.kind === 'navigate' || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
    // Only force a scroll when the target genuinely isn't visible -- on a
    // short page (e.g. the 3-field onboarding form) the target already sits
    // fully on-screen, and scrollIntoView({block:'center'}) still nudges the
    // document by a few px looking for perfect centering. On iOS that tiny
    // forced scroll on a non-overflowing page can trigger a rubber-band
    // overscroll that gets stuck, showing blank space below the nav dock.
    const pre = el.getBoundingClientRect();
    const viewportH = window.innerHeight;
    const fullyVisible = pre.top >= 0 && pre.bottom <= viewportH;
    if (!fullyVisible) {
      // A target taller than roughly half the viewport (e.g. Buffer labels
      // once it has several rows) can't be fully shown by 'center' once the
      // guide dialog also needs its own room -- centering the target just
      // means its top ends up hidden behind the dialog instead, which is
      // why step 15 looked "not scrolled" next to a shorter card like step
      // 16's Backup & transfer. Aligning to the START shows the top of a
      // long card reliably, and also pushes the dialog itself down into the
      // space that opens up below (cardPlacement reacts to the new rect).
      const block = pre.height > viewportH * 0.5 ? 'start' : 'center';
      el.scrollIntoView({ block, behavior: 'instant' });
    }
    // Let scroll settle a frame before measuring.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      // getBoundingClientRect() is relative to the VISUAL viewport, but this
      // overlay is `position: fixed`, which iOS Safari keeps pinned to the
      // LAYOUT viewport -- while the keyboard is open those two disagree by
      // exactly `visualViewport.offsetLeft/offsetTop`. Without adding that
      // back in, the ring renders using visual-viewport coordinates inside a
      // layout-viewport-anchored box, landing off from the real input by
      // however much the keyboard has shifted things.
      const vv = window.visualViewport;
      const offsetX = vv ? vv.offsetLeft : 0;
      const offsetY = vv ? vv.offsetTop : 0;
      const top = r.top + offsetY - PAD;
      // A target taller than the space left below the guide card (e.g. the
      // Buffer labels card once several labels exist) would otherwise draw
      // the ring/hole straight through the floating nav dock, visually
      // "including" it in the highlight even though it has nothing to do
      // with the step. Clamp the bottom edge to just above the dock instead
      // of the target's true full height -- but never when the target IS
      // the dock or something inside it (the FAB, or a tab for a 'navigate'
      // step). A position check (dock top vs target top) isn't reliable for
      // this: the FAB pokes 15px above the pill without expanding the
      // dock's own bounding box, so it read as "above the dock" and got
      // clamped down to almost nothing. Checking ancestry instead is exact.
      const navDock = document.querySelector('.navdock');
      const targetIsInDock = navDock?.contains(el);
      const navDockTop = navDock?.getBoundingClientRect().top;
      const maxBottom = navDockTop != null && !targetIsInDock ? navDockTop - 8 : (vv?.height ?? window.innerHeight);
      const bottom = Math.min(r.top + offsetY + r.height + PAD, maxBottom);
      rect = { top, left: r.left + offsetX - PAD, width: r.width + PAD * 2, height: Math.max(0, bottom - top) };
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
    // iOS Safari resizes the visual viewport (not the layout viewport) when
    // the on-screen keyboard opens/closes, so window's own 'resize' never
    // fires for that -- without this, the ring stays put at its pre-keyboard
    // position while the page (and the input) shift up underneath it.
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', resizeHandler);
      vv.addEventListener('scroll', resizeHandler);
    }
    return () => {
      window.removeEventListener('resize', resizeHandler);
      window.removeEventListener('scroll', resizeHandler, true);
      if (vv) {
        vv.removeEventListener('resize', resizeHandler);
        vv.removeEventListener('scroll', resizeHandler);
      }
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
      {#if !interactive}
        <div class="guide-hole-block" style="top:{rect.top}px; left:{rect.left}px; width:{rect.width}px; height:{rect.height}px;"></div>
      {/if}
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
  /* auto (not the inherited none) so the dimmed area actually blocks taps on
     the real page underneath -- the clip-path hole is the only part of this
     element that isn't hit-tested, which is what lets a 'navigate' step's
     target (or an onboarding input) stay tappable/typable through the hole. */
  .guide-dim { position: absolute; inset: 0; background: rgba(6, 7, 10, 0.78); transition: clip-path 0.25s ease; pointer-events: auto; }
  .guide-ring {
    position: absolute;
    border: 2px solid var(--gold);
    border-radius: 18px;
    box-shadow: 0 0 0 4px var(--gold-dim);
    transition: top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease;
  }
  /* Sits exactly over the spotlight hole for purely-informational steps --
     the hole in .guide-dim is visually transparent but also un-hit-testable,
     so without this a "just look at this" step would let taps fall straight
     through to the real card/button it's merely narrating. */
  .guide-hole-block { position: absolute; pointer-events: auto; background: transparent; }
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
