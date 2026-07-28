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
</script>

<div class="app-shell">
  <div class="view">
    <div class="notch-spacer"></div>
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

  <TabBar onAddClick={() => (addSheetOpen = true)} />

  <AddExpenseSheet open={addSheetOpen} onClose={() => (addSheetOpen = false)} />
  <EndMonthSheet open={endMonthSheetOpen} onClose={() => (endMonthSheetOpen = false)} />

  <Toast />
</div>
