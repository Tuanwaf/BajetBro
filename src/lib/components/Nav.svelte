<script>
  import { currentView } from '../viewStore.js';

  const items = [
    { id: 'home', label: 'Home' },
    { id: 'hutang', label: 'Hutang' },
    { id: 'history', label: 'History' },
    { id: 'settings', label: 'Settings' },
  ];
</script>

<nav class="bottom-nav">
  {#each items as item (item.id)}
    <button class:active={$currentView === item.id} onclick={() => currentView.set(item.id)}>
      {item.label}
    </button>
  {/each}
</nav>

<style>
  .bottom-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    background: #14141a;
    border-top: 1px solid #26262f;
    z-index: 10;
  }
  .bottom-nav button {
    flex: 1;
    padding: 0.75rem 0;
    background: none;
    border: none;
    color: #8a8a99;
    font-size: 0.85rem;
  }
  .bottom-nav button.active {
    color: #e8c766;
  }
</style>
