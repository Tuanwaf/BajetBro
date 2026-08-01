<script>
  import { currentView, addOpen, addIntent } from './lib/viewStore.js';
  import { currentMonth } from './lib/stores.js';
  import { showToast } from './lib/toast.js';
  import TabBar from './lib/components/TabBar.svelte';
  import Toast from './lib/components/Toast.svelte';
  import GuideOverlay from './lib/components/GuideOverlay.svelte';
  import Home from './routes/Home.svelte';
  import Goals from './routes/Goals.svelte';
  import History from './routes/History.svelte';
  import Settings from './routes/Settings.svelte';
  import AddExpenseSheet from './routes/AddExpenseSheet.svelte';
  import EndMonthSheet from './routes/EndMonthSheet.svelte';

  let endMonthSheetOpen = $state(false);
  let viewEl = $state(null);

  function closeAdd() {
    addOpen.set(false);
    addIntent.set(null);
  }

  function handleAddClick() {
    // Nothing to log against yet -- a fresh install has no month until the
    // Home onboarding form creates one.
    if (!$currentMonth) return showToast('Set up your first month on Home first');
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

  <TabBar onAddClick={handleAddClick} />

  <AddExpenseSheet open={$addOpen} intent={$addIntent} onClose={closeAdd} />
  <EndMonthSheet open={endMonthSheetOpen} onClose={() => (endMonthSheetOpen = false)} />

  <Toast />
  <GuideOverlay />
</div>
