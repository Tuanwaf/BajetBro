<script>
  import { template, currentMonth, userName, honorific, devModeEnabled } from '../lib/stores.js';
  import { computeBufferPlannedLive, computeBankFreeTotal, round2 } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { BUFFER_LABEL_PRESETS, GOAL_COLORS } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { exportBackup, importBackup } from '../lib/backup.js';
  import DevStreakPanel from '../lib/components/DevStreakPanel.svelte';
  // Guided tour is disabled for now -- see the commented-out "Help" section
  // below. Uncomment this import alongside it to bring the button back.
  // import { startTour } from '../lib/tour.js';
  import { banks as bankPreviewStore } from '../lib/bankPreviewStore.js';
  import {
    addCategory as addCategoryHelper,
    renameCategory as renameCategoryHelper,
    updateCategoryPlanned as updateCategoryPlannedHelper,
    deleteCategory as deleteCategoryHelper,
    recolorCategory as recolorCategoryHelper,
  } from '../lib/categories.js';
  import ManageBanksSheet from './ManageBanksSheet.svelte';
  import Sortable from 'sortablejs';

  // Drag-to-reorder for Fixed categories/Buffer labels -- a hand-rolled
  // Pointer Events version (setPointerCapture, tracked manually) was tried
  // first, but pointerup unreliably firing after capture on-device (a real
  // iOS Safari flaky spot) left drags stuck "floating" with nothing ever
  // committed, and a plain up/down stepper was too fiddly to tap precisely.
  // SortableJS handles all of touch/mouse/pointer tracking, autoscroll, and
  // the drop reconciliation itself -- one battle-tested library instead of
  // reinventing gesture handling a second time.
  function sortable(node, options) {
    const instance = Sortable.create(node, options);
    return { destroy: () => instance.destroy() };
  }

  let manageBanksOpen = $state(false);

  // Manage Banks now swaps into the same root/document scroll the tabs use
  // (see .sheet-page in app.css) instead of being its own fixed overlay
  // with an independent scroll position -- so opening/closing it needs the
  // same top-reset App.svelte already does when $currentView changes,
  // otherwise it'd show starting from whatever scroll offset Settings
  // happened to be at.
  $effect(() => {
    manageBanksOpen;
    window.scrollTo(0, 0);
  });

  let tmpl = $derived($template);
  let month = $derived($currentMonth);
  let liveTotal = $derived(computeBankFreeTotal($bankPreviewStore));
  let bufferPlanned = $derived(month ? computeBufferPlannedLive(month, liveTotal) : 0);
  let bufferLabels = $derived(tmpl?.bufferLabels ?? BUFFER_LABEL_PRESETS);
  let importing = $state(false);
  let pendingImportFile = $state(null);
  let newBufferLabel = $state('');
  let newCategoryName = $state('');
  let newCategoryColor = $state(GOAL_COLORS[0]);
  // Which existing category is being edited (name + color + planned
  // amount together), or null. These used to be separate, easy-to-miss
  // interactions (tap the name field, tap the dot, tap the amount) -- one
  // Edit action that opens all three at once is more discoverable and
  // matches how every other edit-in-place row in this app already works
  // (CategoryDetailSheet/BufferDetailSheet's own edit forms).
  let editCatIndex = $state(null);
  let editCatName = $state('');
  let editCatColor = $state(GOAL_COLORS[0]);
  let editCatPlanned = $state('');
  function startEditCategory(i) {
    editCatIndex = i;
    editCatName = tmpl.categories[i].name;
    editCatColor = tmpl.categories[i].color;
    editCatPlanned = tmpl.categories[i].planned ? tmpl.categories[i].planned.toFixed(2) : '';
  }
  function cancelEditCategory() {
    editCatIndex = null;
  }
  async function saveEditCategory(i) {
    const name = editCatName.trim();
    if (!name) return showToast('Enter a name first');
    const cat = tmpl.categories[i];
    const planned = parseFloat(editCatPlanned) || 0;
    if (name !== cat.name) await renameCategoryHelper(tmpl, month, i, name);
    if (editCatColor !== cat.color) await recolorCategoryHelper(tmpl, month, i, editCatColor);
    if (planned !== (cat.planned || 0)) await updateCategoryPlannedHelper(tmpl, month, i, planned);
    editCatIndex = null;
  }

  // SortableJS has already physically moved the dragged row's DOM node by
  // the time onEnd fires -- writing the same new order back through
  // db.template (keyed reconciliation) just confirms what's already on
  // screen rather than fighting it. Home renders month.categories in ITS
  // OWN stored order, not the template's, so the month's own copy needs
  // re-sorting to the same key order too, or a reorder would silently not
  // show up there until next cycle.
  async function handleCategoryReorder(evt) {
    const { oldIndex, newIndex } = evt;
    if (oldIndex === newIndex) return;
    const reordered = tmpl.categories.slice();
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    await db.template.put({ ...tmpl, categories: reordered });
    if (month) {
      const keyOrder = reordered.map((c) => c.key);
      const sortedMonthCats = keyOrder.map((k) => month.categories.find((c) => c.key === k)).filter(Boolean);
      await db.months.update(month.key, { categories: sortedMonthCats });
    }
  }
  async function handleLabelReorder(evt) {
    const { oldIndex, newIndex } = evt;
    if (oldIndex === newIndex) return;
    const reordered = bufferLabels.slice();
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);
    await db.template.put({ ...tmpl, bufferLabels: reordered });
  }

  async function updateName(e) {
    const value = e.target.value.trim();
    await db.meta.put({ key: 'userName', value });
  }

  const HONORIFICS = [
    { value: 'bro', label: 'Bro' },
    { value: 'sis', label: 'Sis' },
    { value: '', label: 'Name only' },
  ];
  async function setHonorific(value) {
    await db.meta.put({ key: 'honorific', value });
  }

  async function updateIncome(e) {
    const value = parseFloat(e.target.value) || month.income;
    e.target.value = value.toFixed(2);
    // Income (startingBalance) already has this month's Salary folded into
    // it -- changing Salary alone would leave Income stale/inconsistent, so
    // shift Income by the same delta rather than touching it independently.
    const delta = round2(value - month.income);
    const updates = { income: value };
    if (month.startingBalance != null && delta) {
      updates.startingBalance = round2(month.startingBalance + delta);
    }
    await db.months.update(month.key, updates);
  }

  // Deleting removes the category from the template and the current open month
  // (closed months keep their frozen copy).
  let confirmDeleteKey = $state(null);
  async function deleteCategory(index) {
    const result = await deleteCategoryHelper(tmpl, month, index);
    confirmDeleteKey = null;
    editCatIndex = null;
    showToast(`Removed ${result.name}`);
  }

  async function addCategory() {
    const cat = await addCategoryHelper(tmpl, month, newCategoryName, newCategoryColor);
    if (!cat) return;
    newCategoryName = '';
    showToast(`Added ${cat.name}`);
  }

  async function addBufferLabel() {
    const label = newBufferLabel.trim();
    if (!label) return;
    if (bufferLabels.includes(label)) {
      showToast('That label already exists');
      return;
    }
    await db.template.put({ ...tmpl, bufferLabels: [...bufferLabels, label] });
    newBufferLabel = '';
  }

  // Same Edit-button pattern as Fixed categories -- one explicit action
  // instead of an always-live inline input, so renaming a label isn't
  // something you can trigger by accident just by tapping into the field.
  let editLabelIndex = $state(null);
  let editLabelName = $state('');
  function startEditLabel(i) {
    editLabelIndex = i;
    editLabelName = bufferLabels[i];
  }
  function cancelEditLabel() {
    editLabelIndex = null;
  }
  async function saveEditLabel(i) {
    const oldLabel = bufferLabels[i];
    const value = editLabelName.trim();
    if (!value) return showToast('Enter a name first');
    if (value !== oldLabel) {
      if (bufferLabels.includes(value)) return showToast('That label already exists');
      // Buffer entries store the label as a plain name string (see
      // AddExpenseSheet's newExtra.name) rather than a stable key the way
      // Fixed categories do -- renaming only tmpl.bufferLabels left every
      // month's already-logged entries stuck under the OLD name while the
      // renamed label started fresh with no history, splitting one label
      // into two. Sweep every month (not just the currently open one) and
      // rewrite any entry tagged with the old name to match.
      const allMonths = await db.months.toArray();
      await db.transaction('rw', db.template, db.months, async () => {
        await db.template.put({ ...tmpl, bufferLabels: bufferLabels.map((l, idx) => (idx === i ? value : l)) });
        for (const m of allMonths) {
          if (!m.extras?.some((e) => e.name === oldLabel)) continue;
          const extras = m.extras.map((e) => (e.name === oldLabel ? { ...e, name: value } : e));
          await db.months.update(m.key, { extras });
        }
      });
    }
    editLabelIndex = null;
  }

  let confirmDeleteLabelIdx = $state(null);
  async function deleteBufferLabel(index) {
    const updated = bufferLabels.filter((_, i) => i !== index);
    await db.template.put({ ...tmpl, bufferLabels: updated });
    confirmDeleteLabelIdx = null;
    editLabelIndex = null;
  }

  function handlePickFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    // A native confirm() dialog isn't reliably supported when this app is
    // installed to the Home Screen on iOS, so this uses an in-app prompt
    // instead of window.confirm().
    pendingImportFile = file;
  }

  function cancelImport() {
    pendingImportFile = null;
  }

  async function confirmImport() {
    const file = pendingImportFile;
    pendingImportFile = null;
    importing = true;
    try {
      await importBackup(file);
      showToast('Backup restored');
    } catch (err) {
      showToast(`Import failed: ${err.message}`);
    } finally {
      importing = false;
    }
  }

  async function handleExport() {
    await exportBackup();
    showToast('Exported — save this file somewhere safe');
  }

  // Hidden switch: 7 quick taps on the version number toggles dev mode.
  let versionTaps = 0;
  let versionTapTimer;
  async function tapVersion() {
    versionTaps++;
    clearTimeout(versionTapTimer);
    versionTapTimer = setTimeout(() => (versionTaps = 0), 1500);
    if (versionTaps < 7) return;
    versionTaps = 0;
    const on = !$devModeEnabled;
    await db.meta.put({ key: 'devMode', value: on });
    showToast(on ? 'Dev mode on — see the bottom of Settings' : 'Dev mode off');
  }
</script>

<div style:display={manageBanksOpen ? 'none' : 'contents'}>
<h2 class="title">Commitments setup</h2>
<p class="sub">Fixed categories reappear every month automatically. Buffer gets one pooled budget.</p>

<div class="section-hd" style="margin-top:6px;"><h3>Profile</h3></div>
<div class="card profile-card">
  <div class="profile-row">
    <span class="profile-lbl">Your name</span>
    <input class="cat-name-input" style="text-align:right; flex:0 1 auto; width:140px;" value={$userName} placeholder="e.g. Wafiq" onchange={updateName} />
  </div>
  <div class="profile-row">
    <span class="profile-lbl">Call me</span>
    <div class="hon-toggle" role="radiogroup" aria-label="How the greeting addresses you">
      {#each HONORIFICS as h}
        <button class="hon-btn" class:selected={$honorific === h.value} role="radio" aria-checked={$honorific === h.value} onclick={() => setHonorific(h.value)}>{h.label}</button>
      {/each}
    </div>
  </div>
  <p class="hint" style="margin:8px 0 0;">Home says “Hi {[$honorific === 'bro' ? 'Bro' : $honorific === 'sis' ? 'Sis' : '', $userName].filter(Boolean).join(' ') || 'there'} 👋”</p>
</div>

<div class="section-hd"><h3>Banks</h3></div>
<button class="card" style="display:flex; align-items:center; justify-content:space-between; width:100%; cursor:pointer;" onclick={() => (manageBanksOpen = true)}>
  <span style="font-size:13.5px; color:var(--lo); font-weight:600;">{$bankPreviewStore.length} bank{$bankPreviewStore.length === 1 ? '' : 's'} added</span>
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style="color:var(--dim); flex-shrink:0;"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
</button>

{#if month}
  <div class="section-hd"><h3>Salary baseline</h3></div>
  <div class="card" data-guide="settings-salary" style="display:flex; align-items:center; justify-content:space-between;">
    <span style="font-size:13.5px; color:var(--lo);">Monthly salary</span>
    <input class="set-amt" style="width:100px;" value={month.income.toFixed(2)} onchange={updateIncome} />
  </div>

{/if}

{#if tmpl}
  <div class="section-hd"><h3>Fixed categories</h3><span>tap a category to edit</span></div>
  <div class="card" data-guide="settings-categories">
    <div class="sortable-list" use:sortable={{ handle: '.drag-handle', animation: 150, onEnd: handleCategoryReorder }}>
      {#each tmpl.categories as cat, i (cat.key)}
        <div class="cat-list-item">
          {#if editCatIndex === i}
            <div class="set-row">
              <span class="dot" style="background:{editCatColor}"></span>
              <input class="cat-name-input" bind:value={editCatName} placeholder="Category name" onkeydown={(e) => e.key === 'Enter' && saveEditCategory(i)} />
              <input class="set-amt" bind:value={editCatPlanned} placeholder="0.00" inputmode="decimal" onkeydown={(e) => e.key === 'Enter' && saveEditCategory(i)} />
            </div>
            <div class="color-picker-row" style="margin-top:10px;">
              {#each GOAL_COLORS as c}
                <button class="color-swatch" style="background:{c};" class:selected={editCatColor === c} aria-label="Pick color" onclick={() => (editCatColor = c)}></button>
              {/each}
            </div>
            {#if confirmDeleteKey === cat.key}
              <div class="del-confirm">
                <span>Remove "{cat.name}" and its entries this month?</span>
                <div style="display:flex; gap:8px; margin-top:8px;">
                  <button class="io-btn" style="flex:1;" onclick={() => (confirmDeleteKey = null)}>Cancel</button>
                  <button class="save-btn danger" style="flex:1; margin-top:0;" onclick={() => deleteCategory(i)}>Remove</button>
                </div>
              </div>
            {:else}
              <div style="display:flex; gap:8px; margin:2px 4px 12px;">
                <button class="io-btn" style="flex:1;" onclick={cancelEditCategory}>Cancel</button>
                <button class="save-btn" style="flex:1; margin-top:0;" onclick={() => saveEditCategory(i)}>Save</button>
              </div>
              <button class="io-btn danger" style="width:calc(100% - 8px); margin:0 4px 12px;" onclick={() => (confirmDeleteKey = cat.key)}>Delete category</button>
            {/if}
          {:else}
            <div class="tap-row" onclick={() => startEditCategory(i)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && startEditCategory(i)}>
              <button class="drag-handle" aria-label="Reorder {cat.name}" onclick={(e) => e.stopPropagation()}>
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              </button>
              <span class="dot" style="background:{cat.color}"></span>
              <span class="lbl2">{cat.name}</span>
              <input class="set-amt" value={cat.planned ? cat.planned.toFixed(2) : ''} placeholder="0.00" disabled />
            </div>
          {/if}
        </div>
      {/each}
    </div>
    <div style="display:flex; gap:8px; margin-top:10px;">
      <input class="note-input" placeholder="New category, e.g. Insurance" bind:value={newCategoryName} style="flex:1;" onkeydown={(e) => e.key === 'Enter' && addCategory()} />
      <button class="io-btn" style="width:auto; padding-left:16px; padding-right:16px; background:var(--good); color:#fff;" onclick={addCategory}>Add</button>
    </div>
    <div class="color-picker-row" style="margin-top:6px;">
      {#each GOAL_COLORS as c}
        <button class="color-swatch" style="background:{c};" class:selected={newCategoryColor === c} aria-label="Pick color" onclick={() => (newCategoryColor = c)}></button>
      {/each}
    </div>
  </div>
  <p class="hint" style="margin-left:4px;">Change a category here and it applies from next month.</p>

  <div class="section-hd"><h3>Buffer</h3><span>auto-computed</span></div>
  <div class="card" data-guide="settings-buffer">
    <div class="set-row" style="border:none;">
      <span class="dot" style="background:var(--c-buffer)"></span>
      <span class="lbl2">This month's Buffer allocation</span>
      <span class="num" style="font-weight:700; font-size:14px;">{fmt(bufferPlanned)}</span>
    </div>
    <p class="hint" style="margin-top:4px;">= your real bank balances (free to spend, across every bank) − fixed commitments not yet paid. No need to set this — it's recalculated live.</p>
  </div>

  <div class="section-hd"><h3>Buffer labels</h3><span>tap a label to edit</span></div>
  <div class="card" data-guide="settings-buffer-labels">
    <div class="sortable-list" use:sortable={{ handle: '.drag-handle', animation: 150, onEnd: handleLabelReorder }}>
      {#each bufferLabels as label, i (label)}
        <div class="cat-list-item">
          {#if editLabelIndex === i}
            <div class="set-row">
              <input class="cat-name-input buffer-label-input" bind:value={editLabelName} placeholder="Label name" onkeydown={(e) => e.key === 'Enter' && saveEditLabel(i)} />
            </div>
            {#if confirmDeleteLabelIdx === i}
              <div class="del-confirm">
                <span>Remove "{label}"?</span>
                <div style="display:flex; gap:8px; margin-top:8px;">
                  <button class="io-btn" style="flex:1;" onclick={() => (confirmDeleteLabelIdx = null)}>Cancel</button>
                  <button class="save-btn danger" style="flex:1; margin-top:0;" onclick={() => deleteBufferLabel(i)}>Remove</button>
                </div>
              </div>
            {:else}
              <div style="display:flex; gap:8px; margin:12px 4px 12px;">
                <button class="io-btn" style="flex:1;" onclick={cancelEditLabel}>Cancel</button>
                <button class="save-btn" style="flex:1; margin-top:0;" onclick={() => saveEditLabel(i)}>Save</button>
              </div>
              <button class="io-btn danger" style="width:calc(100% - 8px); margin:0 4px 12px;" onclick={() => (confirmDeleteLabelIdx = i)}>Delete label</button>
            {/if}
          {:else}
            <div class="tap-row" onclick={() => startEditLabel(i)} role="button" tabindex="0" onkeydown={(e) => e.key === 'Enter' && startEditLabel(i)}>
              <button class="drag-handle" aria-label="Reorder {label}" onclick={(e) => e.stopPropagation()}>
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
              </button>
              <span class="lbl2">{label}</span>
            </div>
          {/if}
        </div>
      {:else}
        <p class="hint" style="margin:2px 0;">No labels yet — add one below.</p>
      {/each}
    </div>
    <div style="display:flex; gap:8px; margin-top:10px;">
      <input class="note-input" placeholder="New label, e.g. Gifts" bind:value={newBufferLabel} style="flex:1;" onkeydown={(e) => e.key === 'Enter' && addBufferLabel()} />
      <button class="io-btn" style="width:auto; padding-left:16px; padding-right:16px; background:var(--good); color:#fff;" onclick={addBufferLabel}>Add</button>
    </div>
  </div>
  <p class="hint" style="margin-left:4px;">These are the quick-pick chips shown when logging a Buffer expense — you can still type a one-off custom label there too.</p>
{/if}

<div class="section-hd"><h3>Backup &amp; transfer</h3><span>move to another device</span></div>
<div class="card" data-guide="settings-backup" style="display:flex; flex-direction:column; gap:10px;">
  <button class="io-btn" style="background:var(--gold); color:var(--accent-ink);" onclick={handleExport}>
    <svg viewBox="0 0 24 24" fill="none"><path d="M12 15V3M7 8l5-5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Export backup (.json)
  </button>
  <label class="io-btn" style="cursor:pointer; background:var(--gold); color:var(--accent-ink);">
    <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12M7 10l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Import backup
    <input type="file" accept=".json,application/json" onchange={handlePickFile} disabled={importing} style="display:none" />
  </label>
  <p class="hint">Everything — commitments, this cycle, goals, dividends — bundles into one file. Import it on your next device to pick up exactly where you left off.</p>
</div>

<!--
Guided tour disabled for now -- revisit later if still wanted.
<div class="section-hd"><h3>Help</h3></div>
<button class="io-btn" style="background:var(--good); color:#fff;" onclick={startTour}>
  <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/><path d="M9.5 9a2.5 2.5 0 0 1 4.8 1c0 1.5-2.3 1.8-2.3 3.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="12" cy="16.6" r="0.9" fill="currentColor"/></svg>
  Replay the guided tour
</button>
-->

{#if pendingImportFile}
  <div class="card" style="margin-top:12px; border-color:var(--red); box-shadow: 4px 4px 0 var(--red);">
    <div class="cat-name-row" style="margin-bottom:8px;"><span>Replace all local data?</span></div>
    <p class="hint" style="margin:0 0 14px;">Importing "{pendingImportFile.name}" will overwrite everything currently stored on this device. This can't be undone.</p>
    <div style="display:flex; gap:10px;">
      <button class="io-btn" style="flex:1;" onclick={cancelImport}>Cancel</button>
      <button class="save-btn" style="flex:1; margin-top:0;" onclick={confirmImport}>Import</button>
    </div>
  </div>
{/if}

{#if import.meta.env.DEV || $devModeEnabled}
  <DevStreakPanel />
{/if}

<!-- Bumped by hand on every push -- check this against what you were told
     to expect to confirm the installed app actually picked up the latest
     deploy, not a stale cached build. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
<p class="hint" style="text-align:center; margin-top:22px; user-select:none;" onclick={tapVersion}>BajetBro v{__APP_VERSION__}</p>
</div>

<ManageBanksSheet open={manageBanksOpen} onClose={() => (manageBanksOpen = false)} />

<style>
  .profile-card { display: flex; flex-direction: column; gap: 10px; }
  .profile-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .profile-lbl { font-size: 13.5px; color: var(--lo); }
  .hon-toggle { display: flex; gap: 3px; padding: 3px; border: 2px solid var(--stroke-2); border-radius: 12px; background: var(--panel-2); }
  .hon-btn { border: none; background: none; border-radius: 9px; padding: 6px 11px; font-size: 12.5px; font-weight: 700; color: var(--dim); }
  .hon-btn.selected { background: var(--gold); color: var(--accent-ink); }
  /* This row specifically (not every .set-row in the app -- Svelte scopes
     this to Settings.svelte) uses a tighter gap than the global 12px. */
  .set-row {
    gap: 8px;
  }
  /* Edit/Delete no longer live as buttons on the row at all (an
     always-visible pair, then a swipe-to-reveal pair, were both tried and
     both added friction/fragility for what's really a rare action) --
     tapping the row itself now opens the same edit panel that used to
     need a separate pencil tap, with Delete moved inside it as its own
     button. .tap-row replaces .set-row/.swipe-row as the view-mode row's
     class, so it needs the same rule the global stylesheet gives .lbl2
     inside .set-row specifically (".set-row .lbl2"), which wouldn't
     otherwise match here -- without flex:1 the name doesn't expand to
     fill the row, and nothing is left pushing the amount to the far
     right. */
  .tap-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 13px 4px;
    border-bottom: 1px solid var(--stroke);
    cursor: pointer;
  }
  .sortable-list .cat-list-item:last-child .tap-row {
    border-bottom: none;
  }
  .tap-row .lbl2 {
    flex: 1;
    font-size: 14px;
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Same red treatment .save-btn.danger already uses elsewhere in the app
     (app.css) -- .io-btn has no danger variant of its own yet. */
  .io-btn.danger {
    background: var(--red);
    color: #2a0709;
  }
  /* SortableJS wrapper -- a hand-rolled Pointer Events drag (setPointerCapture,
     tracked manually) and an up/down stepper were both tried first: the
     drag version left pointerup unreliably firing on-device (a real iOS
     Safari flaky spot), stranding drags "floating" with nothing committed,
     and the stepper's tiny buttons were too easy to mis-tap up vs down.
     SortableJS owns all of the touch/mouse tracking, autoscroll, and drop
     reconciliation itself instead of reinventing gesture handling again.
     Each category/label needs to be exactly one direct child of this
     wrapper (.cat-list-item below) for Sortable to treat it as one row,
     even though its OWN content branches (edit form vs. view row vs. an
     optional delete-confirm) still vary underneath that single wrapper. */
  .sortable-list .cat-list-item {
    /* Sortable's own drag ghost/placeholder styling expects a plain block
       box per item -- nothing needed here beyond letting children stack
       normally (.set-row/.del-confirm already carry their own spacing). */
  }
  .drag-handle {
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    background: none;
    border: none;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--dim);
    touch-action: none;
    cursor: grab;
  }
  /* SortableJS's default classes for the dragged item and its drop
     placeholder -- both scoped to Settings.svelte like everything else
     here, not global, so they can't leak into some other Sortable use
     elsewhere in the app later. */
  :global(.sortable-list .sortable-ghost) {
    opacity: 0.3;
  }
  :global(.sortable-list .sortable-drag) {
    background: var(--panel-2);
    border-radius: 12px;
    box-shadow: 3px 3px 0 var(--stroke-2);
  }
  .color-picker-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    padding: 4px 4px 8px;
  }
  .color-swatch {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2px solid var(--stroke-2);
    flex-shrink: 0;
  }
  .color-swatch.selected {
    outline: 2.5px solid var(--stroke-2);
    outline-offset: 2px;
  }
  /* The collapsed row's amount is now a plain display, not a shortcut
     edit -- tap the pencil to actually change it. Dimming it is the visual
     cue that it's not directly interactive here anymore. */
  .set-amt:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .cat-name-input {
    flex: 1;
    min-width: 0;
    background: none;
    border: none;
    border-bottom: 1px dashed transparent;
    color: var(--hi);
    font-family: var(--body);
    font-size: 14px;
    font-weight: 600;
    padding: 2px 0;
  }
  .cat-name-input:focus {
    outline: none;
    border-bottom-color: var(--stroke-2);
  }
</style>
