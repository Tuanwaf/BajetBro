<script>
  import { currentMonth, template, hutangPots } from '../lib/stores.js';
  import { computePotRemain, computeOpenPots } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { ADHOC_COLOR, HUTANG_CHIP_COLOR, ADHOC_LABEL_PRESETS, HUTANG_ENTRY_TYPES } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { currentView } from '../lib/viewStore.js';

  let { open, onClose } = $props();

  let month = $derived($currentMonth);
  let tmpl = $derived($template);
  let pots = $derived($hutangPots ?? []);
  let openPots = $derived(computeOpenPots(pots));

  let selectedCatKey = $state(null); // category key, 'adhoc', or 'hutang'
  let selectedAdhocLabel = $state(null);
  let selectedHutangType = $state(null);
  let selectedHutangMonth = $state(null);
  let kpValue = $state('0');
  let noteValue = $state('');

  function reset() {
    selectedCatKey = null;
    selectedAdhocLabel = null;
    selectedHutangType = null;
    selectedHutangMonth = null;
    kpValue = '0';
    noteValue = '';
  }

  $effect(() => {
    if (open) reset();
  });

  function pressKey(k) {
    if (k === '⌫') {
      kpValue = kpValue.length > 1 ? kpValue.slice(0, -1) : '0';
    } else if (k === '.' && kpValue.includes('.')) {
      // no-op
    } else {
      kpValue = kpValue === '0' && k !== '.' ? k : kpValue + k;
    }
  }

  function selectCat(key) {
    selectedCatKey = key;
    selectedAdhocLabel = null;
    selectedHutangType = null;
    selectedHutangMonth = null;
  }

  async function save() {
    const amt = parseFloat(kpValue || '0');
    if (!selectedCatKey || !amt) {
      showToast('Pick a category and amount first');
      return;
    }

    if (selectedCatKey === 'adhoc') {
      const extras = [...(month.extras || []), { name: selectedAdhocLabel || 'Misc', actual: amt }];
      await db.months.update(month.key, { extras });
      showToast(`Saved RM ${fmt(amt)} · Ad-hoc / ${selectedAdhocLabel || 'Misc'}`);
      onClose();
      currentView.set('home');
    } else if (selectedCatKey === 'hutang') {
      if (selectedHutangMonth == null) {
        showToast("Pick which month's pot first");
        return;
      }
      if (!selectedHutangType) {
        showToast('Choose Send or Used first');
        return;
      }
      const pot = pots.find((p) => p.month === selectedHutangMonth);
      const remain = computePotRemain(pot);
      let applyAmt = amt;
      let capped = false;
      if (applyAmt > remain) {
        applyAmt = remain;
        capped = true;
      }
      const field = selectedHutangType === 'send' ? 'send' : 'used';
      await db.hutangPots.update(pot.month, { [field]: pot[field] + applyAmt });
      const dest = selectedHutangType === 'send' ? 'Sent to Mom' : 'Used';
      showToast(
        capped
          ? `Capped to RM ${fmt(applyAmt)} left in ${pot.month} · ${dest}`
          : `Saved RM ${fmt(applyAmt)} · Hutang / ${dest} (${pot.month})`
      );
      onClose();
      currentView.set('hutang');
    } else {
      const categories = month.categories.map((c) => (c.key === selectedCatKey ? { ...c, actual: c.actual + amt } : c));
      await db.months.update(month.key, { categories });
      const cat = tmpl.categories.find((c) => c.key === selectedCatKey);
      showToast(`Saved RM ${fmt(amt)} · ${cat?.name ?? ''}`);
      onClose();
      currentView.set('home');
    }
  }
</script>

<div class="sheet" class:open>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>Add expense</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-body">
    <div class="amt-display"><span class="cur">RM</span><span class="val">{kpValue}</span></div>

    <div class="field-lbl">Category</div>
    <div class="chip-grid">
      {#if tmpl}
        {#each tmpl.categories as cat (cat.key)}
          <button class="chip" class:selected={selectedCatKey === cat.key} style="color:{cat.color}" onclick={() => selectCat(cat.key)}>
            <span class="dot" style="background:{cat.color}"></span>{cat.name}
          </button>
        {/each}
      {/if}
      <button class="chip" class:selected={selectedCatKey === 'adhoc'} style="color:{ADHOC_COLOR}" onclick={() => selectCat('adhoc')}>
        <span class="dot" style="background:{ADHOC_COLOR}"></span>Ad-hoc
      </button>
      <button class="chip" class:selected={selectedCatKey === 'hutang'} style="color:{HUTANG_CHIP_COLOR}" onclick={() => selectCat('hutang')}>
        <span class="dot" style="background:{HUTANG_CHIP_COLOR}"></span>Hutang (Mom)
      </button>
    </div>

    {#if selectedCatKey === 'adhoc'}
      <div class="field-lbl">Ad-hoc label</div>
      <div class="chip-grid">
        {#each ADHOC_LABEL_PRESETS as label}
          <button
            class="chip ghost"
            class:selected={selectedAdhocLabel === label}
            style={selectedAdhocLabel === label ? `color:${ADHOC_COLOR}` : ''}
            onclick={() => (selectedAdhocLabel = label)}
          >{label}</button>
        {/each}
      </div>
    {/if}

    {#if selectedCatKey === 'hutang'}
      <div class="field-lbl">Which month's pot?</div>
      <div class="chip-grid">
        {#if openPots.length}
          {#each openPots as pot (pot.month)}
            <button
              class="chip ghost"
              class:selected={selectedHutangMonth === pot.month}
              style={selectedHutangMonth === pot.month ? 'color:var(--h-remain)' : ''}
              onclick={() => (selectedHutangMonth = pot.month)}
            >{pot.month} · RM {fmt(computePotRemain(pot))} left</button>
          {/each}
        {:else}
          <p class="hint" style="margin:0 0 6px;">No open pots yet — start a month first.</p>
        {/if}
      </div>
      <div class="field-lbl">Where did it go?</div>
      <div class="chip-grid">
        {#each HUTANG_ENTRY_TYPES as opt (opt.type)}
          <button
            class="chip ghost"
            class:selected={selectedHutangType === opt.type}
            style={selectedHutangType === opt.type ? `color:${opt.color}` : ''}
            onclick={() => (selectedHutangType = opt.type)}
          >{opt.label}</button>
        {/each}
      </div>
      <p class="hint">This tracks money already set aside in a Saving pot — it won't change this month's remaining balance.</p>
    {/if}

    <div class="field-lbl">Note (optional)</div>
    <input class="note-input" placeholder="e.g. Deposit, top-up, refund…" bind:value={noteValue} />

    <div class="field-lbl">Amount</div>
    <div class="keypad">
      {#each ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'] as k}
        <button class="key" class:op={k === '⌫'} onclick={() => pressKey(k)}>{k}</button>
      {/each}
    </div>

    <button class="save-btn" onclick={save}>Save expense</button>
  </div>
</div>
