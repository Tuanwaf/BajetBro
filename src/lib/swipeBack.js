// Swipe-from-anywhere-to-go-back for the app's plain X-only sheets (no
// separate Back button -- EndMonthSheet/AddExpenseSheet have their own step
// navigation and are deliberately left out of this).
//
// Plain touch events (touchstart/touchmove/touchend), NOT Pointer Events +
// setPointerCapture -- that combination is exactly what made drag-reorder
// unreliable on iOS Safari earlier in this app's history (pointerup not
// firing reliably after capture); a passive touch listener has no such
// failure mode.
//
// v2: live drag-follow. The first version deliberately never touched the
// DOM mid-gesture at all (just watched touchstart/touchend deltas) -- this
// app has a documented history of touch gestures with visual feedback
// fighting real-device scroll/timing in ways that never reproduced in a
// desktop browser (see the feedback-bajetbro-ios-css memory), so shipping
// the simplest possible version first was deliberate. This grows that into
// a real drag-follow, gated behind a direction lock so a real vertical
// scroll is never fought over:
//   - Every touch starts in 'pending' (undecided) state.
//   - Once movement exceeds LOCK_PX, direction is decided ONCE: mostly
//     vertical (or leftward -- not a "back" gesture) hands off to native
//     scroll and never touches the DOM; mostly horizontal-and-rightward
//     locks into 'dragging' and starts following the finger.
//   - Only once locked into 'dragging' does this call preventDefault (on
//     touchmove) and go non-passive for that listener, so the page can't
//     ALSO scroll vertically while it's being visually dragged sideways.
//     Everything before that lock is still a plain passive touch listener,
//     same as v1.
//
// v3: fade-and-lift instead of slide-to-reveal. Every one of these sheets
// is a .sheet-page -- whatever would normally sit "behind" it (the parent
// page, or the sheet underneath it in a stack) is deliberately
// display:none while it's open, so a plain translateX here just slides the
// sheet away to reveal blank background instead of a real page, which read
// as broken rather than a genuine "back" gesture. Properly showing a real
// page behind it would mean this action reaching into and coordinating
// with each parent's own (differently-wired, per-component) hide-state --
// real added complexity across every sheet for a purely cosmetic payoff.
// Fading + scaling the sheet down as it's dragged instead needs nothing
// behind it at all: it reads as "lifting away/dismissing" rather than
// "revealing what's underneath," self-contained to this one element, same
// footprint as before. A light horizontal translate stays alongside it
// (damped, not 1:1 with the finger) purely so the motion still reads as
// "pushed to the right," not just a fade in place.
const THRESHOLD = 80; // px of rightward travel to commit to closing
const LOCK_PX = 10; // px of movement before direction is decided
const DRAG_RANGE = 240; // px of drag over which the fade/scale ramps to its max
const DRAG_TRANSLATE_FACTOR = 0.4; // how much of the raw finger delta the translate follows (damped, not 1:1)
const MAX_SCALE_DOWN = 0.06; // scale shrinks to (1 - this) at DRAG_RANGE
const MAX_FADE = 0.65; // opacity drops to (1 - this) at DRAG_RANGE
const CLOSE_MS = 150;
const CANCEL_MS = 40;
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

// A touch starting inside a horizontally-scrollable row (chip-scroll,
// bank-figure-scroll, a color-picker row, etc.) needs its swipe to reach
// THAT scroller, not be hijacked into closing the whole sheet -- walked from
// the actual touch target up to (not including) the sheet root itself.
function startsInHorizontalScroller(target, root) {
  let el = target;
  while (el && el !== root) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === 'auto' || overflowX === 'scroll') return true;
    }
    el = el.parentElement;
  }
  return false;
}

export function swipeBack(node, onClose) {
  let close = onClose;
  let startX = 0;
  let startY = 0;
  // 'idle' (nothing happening) -> 'pending' (touch down, direction not
  // decided yet) -> 'dragging' (locked horizontal, following the finger) or
  // 'native' (locked vertical/leftward, hands off to the browser entirely).
  let state = 'idle';

  function applyDrag(dx) {
    const t = Math.min(1, dx / DRAG_RANGE);
    node.style.transition = 'none';
    node.style.transform = `translateX(${dx * DRAG_TRANSLATE_FACTOR}px) scale(${1 - t * MAX_SCALE_DOWN})`;
    node.style.opacity = String(1 - t * MAX_FADE);
  }

  function resetInline() {
    node.style.transition = 'none';
    node.style.transform = '';
    node.style.opacity = '';
    node.style.willChange = '';
  }

  function settleClosed() {
    node.style.transition = `transform ${CLOSE_MS}ms ${EASE}, opacity ${CLOSE_MS}ms ${EASE}`;
    node.style.transform = `translateX(${DRAG_RANGE * DRAG_TRANSLATE_FACTOR * 1.5}px) scale(${1 - MAX_SCALE_DOWN * 1.5})`;
    node.style.opacity = '0';
    const onDone = () => {
      node.removeEventListener('transitionend', onDone);
      // Reset BEFORE calling close() -- close() flips the `open` prop,
      // which (once re-opened later) needs a clean slate, not last time's
      // leftover inline styles sitting on top of the CSS `.open` state.
      resetInline();
      close?.();
    };
    node.addEventListener('transitionend', onDone);
  }

  function settleOpen() {
    node.style.transition = `transform ${CANCEL_MS}ms ${EASE}, opacity ${CANCEL_MS}ms ${EASE}`;
    node.style.transform = 'translateX(0px) scale(1)';
    node.style.opacity = '1';
    const onDone = () => {
      node.removeEventListener('transitionend', onDone);
      resetInline();
    };
    node.addEventListener('transitionend', onDone);
  }

  function onTouchStart(e) {
    if (e.touches.length !== 1) {
      state = 'idle';
      return;
    }
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    state = startsInHorizontalScroller(e.target, node) ? 'native' : 'pending';
  }

  function onTouchMove(e) {
    if (state === 'idle' || state === 'native') return;
    const t = e.touches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (state === 'pending') {
      if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return; // not enough movement to decide yet
      if (dx <= 0 || Math.abs(dy) > Math.abs(dx)) {
        // Vertical (or leftward, not a "back" gesture) -- hand off to
        // native scroll for the rest of this touch and never touch the DOM.
        state = 'native';
        return;
      }
      state = 'dragging';
      node.style.willChange = 'transform, opacity';
    }

    // Only reached once locked into 'dragging' -- safe to claim this touch
    // exclusively now, since a real vertical scroll was already ruled out
    // above, not guessed at.
    e.preventDefault();
    applyDrag(Math.max(0, dx));
  }

  function onTouchEnd(e) {
    if (state !== 'dragging') {
      state = 'idle';
      return;
    }
    state = 'idle';
    const t = e.changedTouches[0];
    const dx = t ? Math.max(0, t.clientX - startX) : 0;
    if (dx > THRESHOLD) settleClosed();
    else settleOpen();
  }

  function onTouchCancel() {
    if (state === 'dragging') settleOpen();
    state = 'idle';
  }

  node.addEventListener('touchstart', onTouchStart, { passive: true });
  // Not passive -- onTouchMove calls preventDefault() once locked into
  // 'dragging', which passive:true would silently ignore.
  node.addEventListener('touchmove', onTouchMove, { passive: false });
  node.addEventListener('touchend', onTouchEnd, { passive: true });
  node.addEventListener('touchcancel', onTouchCancel, { passive: true });

  return {
    update(newOnClose) {
      close = newOnClose;
    },
    destroy() {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
    },
  };
}
