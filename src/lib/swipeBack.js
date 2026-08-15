// Swipe-from-anywhere-to-go-back for the app's plain X-only sheets (no
// separate Back button -- EndMonthSheet/AddExpenseSheet have their own step
// navigation and are deliberately left out of this).
//
// Plain touch events (touchstart/touchmove/touchend), NOT Pointer Events +
// setPointerCapture -- that combination is exactly what made drag-reorder
// unreliable on iOS Safari earlier in this app's history (pointerup not
// firing reliably after capture); a passive touch listener has no such
// failure mode. Never calls preventDefault and never live-follows the
// finger with a transform -- this only WATCHES the gesture and calls
// onClose() once, after release, if it looks like a deliberate rightward
// swipe. Both omissions are deliberate: this app has a documented history of
// touch gestures with visual feedback fighting real-device scroll/timing in
// ways that never reproduced in a desktop browser (see the
// feedback-bajetbro-ios-css memory) -- the safest version of this feature is
// the simplest one, so this ships that first and only grows a live-follow
// animation later if it's actually wanted.
const THRESHOLD = 80; // px of rightward travel to count as "swipe back"
const MAX_VERTICAL_RATIO = 0.5; // vertical drift must stay under half the horizontal travel

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
  let tracking = false;

  function onTouchStart(e) {
    if (e.touches.length !== 1) {
      tracking = false;
      return;
    }
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    tracking = !startsInHorizontalScroller(e.target, node);
  }

  function onTouchEnd(e) {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - startX;
    const dy = Math.abs(t.clientY - startY);
    if (dx > THRESHOLD && dy < dx * MAX_VERTICAL_RATIO) close?.();
  }

  function onTouchCancel() {
    tracking = false;
  }

  node.addEventListener('touchstart', onTouchStart, { passive: true });
  node.addEventListener('touchend', onTouchEnd, { passive: true });
  node.addEventListener('touchcancel', onTouchCancel, { passive: true });

  return {
    update(newOnClose) {
      close = newOnClose;
    },
    destroy() {
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchCancel);
    },
  };
}
