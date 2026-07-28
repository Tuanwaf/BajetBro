<script>
  import { currentView } from '../viewStore.js';

  let { onAddClick } = $props();

  const tabs = [
    { id: 'home', label: 'Home' },
    { id: 'hutang', label: 'Hutang' },
  ];
  const tabs2 = [
    { id: 'history', label: 'History' },
    { id: 'settings', label: 'Settings' },
  ];
</script>

<div class="tabbar">
  {#each tabs as t (t.id)}
    <button class="tab" class:active={$currentView === t.id} onclick={() => currentView.set(t.id)}>
      {#if t.id === 'home'}
        <svg viewBox="0 0 24 24" fill="none"><path d="M4 11.5 12 4l8 7.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10v9h12v-9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 19s-6.5-4.35-6.5-9A3.8 3.8 0 0 1 12 7.8 3.8 3.8 0 0 1 18.5 10c0 4.65-6.5 9-6.5 9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      {/if}
      {t.label}
    </button>
  {/each}

  <div class="tab-spacer"></div>
  <button class="fab" aria-label="Add expense" onclick={onAddClick}>
    <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="#241a05" stroke-width="2.4" stroke-linecap="round"/></svg>
  </button>

  {#each tabs2 as t (t.id)}
    <button class="tab" class:active={$currentView === t.id} onclick={() => currentView.set(t.id)}>
      {#if t.id === 'history'}
        <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {:else}
        <svg viewBox="0 0 24 24" fill="none"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" stroke="currentColor" stroke-width="1.6"/><path d="M19.4 12a7.4 7.4 0 0 0-.1-1.2l1.9-1.5-2-3.4-2.2.9a7.6 7.6 0 0 0-2.1-1.2L14.6 3H9.4l-.3 2.6a7.6 7.6 0 0 0-2.1 1.2l-2.2-.9-2 3.4L4.7 10.8a7.4 7.4 0 0 0 0 2.4L2.8 15l2 3.4 2.2-.9c.6.5 1.3.9 2.1 1.2l.3 2.6h5.2l.3-2.6c.8-.3 1.5-.7 2.1-1.2l2.2.9 2-3.4-1.9-1.5c.1-.4.1-.8.1-1.2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
      {/if}
      {t.label}
    </button>
  {/each}
</div>
