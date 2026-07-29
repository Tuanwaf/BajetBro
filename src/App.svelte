<script>
  import { currentView } from './lib/viewStore.js';
  import TabBar from './lib/components/TabBar.svelte';
  import Toast from './lib/components/Toast.svelte';
  import Home from './routes/Home.svelte';
  import Hutang from './routes/Hutang.svelte';
  import History from './routes/History.svelte';
  import Settings from './routes/Settings.svelte';
  import AddExpenseSheet from './routes/AddExpenseSheet.svelte';
  import EndMonthSheet from './routes/EndMonthSheet.svelte';

  let addSheetOpen = $state(false);
  let endMonthSheetOpen = $state(false);

  // Every page shares one document scroll, so switching tabs would otherwise
  // inherit the previous page's scroll offset. Reset to the top on change.
  $effect(() => {
    $currentView;
    window.scrollTo(0, 0);
  });
</script>

<div class="app-shell">
  <div class="view">
    <section class="page" class:active={$currentView === 'home'}>
      <Home onEndMonth={() => (endMonthSheetOpen = true)} />
    </section>
    <section class="page" class:active={$currentView === 'hutang'}>
      <Hutang />
    </section>
    <section class="page" class:active={$currentView === 'history'}>
      <History />
    </section>
    <section class="page" class:active={$currentView === 'settings'}>
      <Settings />
    </section>
  </div>

  <div class="status-bar-blur"></div>

  <TabBar onAddClick={() => (addSheetOpen = true)} />

  <AddExpenseSheet open={addSheetOpen} onClose={() => (addSheetOpen = false)} />
  <EndMonthSheet open={endMonthSheetOpen} onClose={() => (endMonthSheetOpen = false)} />

  <Toast />
</div>
