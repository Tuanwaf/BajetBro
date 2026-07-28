<script>
  import { currentView } from './lib/viewStore.js';
  import Nav from './lib/components/Nav.svelte';
  import Home from './routes/Home.svelte';
  import Hutang from './routes/Hutang.svelte';
  import History from './routes/History.svelte';
  import Settings from './routes/Settings.svelte';
  import EndMonth from './routes/EndMonth.svelte';
</script>

<main>
  {#if $currentView === 'home'}
    <Home />
  {:else if $currentView === 'hutang'}
    <Hutang />
  {:else if $currentView === 'history'}
    <History />
  {:else if $currentView === 'settings'}
    <Settings />
  {:else if $currentView === 'endMonth'}
    <EndMonth />
  {/if}
</main>

<Nav />

<style>
  main {
    max-width: 480px;
    margin: 0 auto;
    padding: 1.25rem 1.25rem 4.5rem;
  }
</style>
