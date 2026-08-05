<script>
  import { currentView, addOpen, addIntent, addOriginRect } from './lib/viewStore.js';
  import { currentMonth } from './lib/stores.js';
  import { showToast } from './lib/toast.js';
  import TabBar from './lib/components/TabBar.svelte';
  import Toast from './lib/components/Toast.svelte';
  import GuideOverlay from './lib/components/GuideOverlay.svelte';
  import InstallBanner from './lib/components/InstallBanner.svelte';
  import Home from './routes/Home.svelte';
  import Goals from './routes/Goals.svelte';
  import History from './routes/History.svelte';
  import Settings from './routes/Settings.svelte';
  import AddExpenseSheet from './routes/AddExpenseSheet.svelte';
  import EndMonthSheet from './routes/EndMonthSheet.svelte';

  let endMonthSheetOpen = $state(false);
  let viewEl = $state(null);
  let keyboardOpen = $state(false);

  // iOS Safari doesn't reliably keep position:fixed elements pinned to the
  // visible area once the on-screen keyboard covers part of the screen (a
  // longstanding platform limitation, not a one-off glitch) -- fighting it
  // with viewport math backfired before. Hiding the tab bar while a text
  // field has focus sidesteps the whole problem instead of chasing it.
  const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'file', 'range', 'button', 'submit']);
  function isTextField(el) {
    if (!el) return false;
    if (el.tagName === 'TEXTAREA') return true;
    return el.tagName === 'INPUT' && !NON_TEXT_INPUT_TYPES.has(el.type);
  }
  function handleFocusIn(e) {
    if (isTextField(e.target)) keyboardOpen = true;
  }
  function handleFocusOut(e) {
    if (isTextField(e.target)) keyboardOpen = false;
  }

  function closeAdd() {
    addOpen.set(false);
    addIntent.set(null);
  }

  function handleAddClick(rect) {
    // Nothing to log against yet -- a fresh install has no month until the
    // Home onboarding form creates one.
    if (!$currentMonth) return showToast('Set up your first month on Home first');
    // Plain object, not the live DOMRect -- getBoundingClientRect() is
    // already a snapshot, but copying defensively costs nothing and avoids
    // ever depending on DOMRect-specific behavior downstream.
    addOriginRect.set(rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null);
    addOpen.set(true);
  }

  // Only allow the iOS rubber-band bounce when the page is actually tall
  // enough to scroll. On a short page (e.g. History before expanding a month)
  // bouncing an unscrollable page feels wrong, so we lock overscroll to
  // 'none' there and switch it back to 'auto' once content overflows.
  function refreshBounce() {
    const scrollable = document.documentElement.scrollHeight > window.innerHeight + 1;
    const mode = scrollable ? 'auto' : 'none';
    document.documentElement.style.overscrollBehaviorY = mode;
    document.body.style.overscrollBehaviorY = mode;
  }

  // Every page shares one document scroll, so switching tabs would otherwise
  // inherit the previous page's scroll offset. Reset to the top on change,
  // then re-evaluate scrollability once the new page has rendered.
  $effect(() => {
    $currentView;
    window.scrollTo(0, 0);
    requestAnimationFrame(refreshBounce);
  });

  // Re-check whenever the content's height changes -- expanding/collapsing a
  // History month, data loading, etc. -- and on viewport resize/rotation.
  $effect(() => {
    if (!viewEl) return;
    refreshBounce();
    const ro = new ResizeObserver(refreshBounce);
    ro.observe(viewEl);
    window.addEventListener('resize', refreshBounce);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', refreshBounce);
    };
  });

  $effect(() => {
    document.addEventListener('focusin', handleFocusIn);
    document.addEventListener('focusout', handleFocusOut);
    return () => {
      document.removeEventListener('focusin', handleFocusIn);
      document.removeEventListener('focusout', handleFocusOut);
    };
  });
</script>

<div class="app-shell">
  <div class="view" bind:this={viewEl}>
    <section class="page" class:active={$currentView === 'home'}>
      <Home onEndMonth={() => (endMonthSheetOpen = true)} />
    </section>
    <section class="page" class:active={$currentView === 'goals'}>
      <Goals />
    </section>
    <section class="page" class:active={$currentView === 'history'}>
      <History />
    </section>
    <section class="page" class:active={$currentView === 'settings'}>
      <Settings />
    </section>
  </div>

  <div class="status-bar-blur"></div>

  <TabBar onAddClick={handleAddClick} hidden={keyboardOpen} />

  <AddExpenseSheet open={$addOpen} intent={$addIntent} originRect={$addOriginRect} onClose={closeAdd} />
  <EndMonthSheet open={endMonthSheetOpen} onClose={() => (endMonthSheetOpen = false)} />

  <Toast />
  <GuideOverlay />
  <InstallBanner hidden={$addOpen || endMonthSheetOpen} />
</div>
