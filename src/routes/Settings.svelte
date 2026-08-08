<script>
  import { template, currentMonth, userName } from '../lib/stores.js';
  import { computeBufferPlanned, round2 } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { BUFFER_LABEL_PRESETS } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { exportBackup, importBackup } from '../lib/backup.js';
  // Guided tour is disabled for now -- see the commented-out "Help" section
  // below. Uncomment this import alongside it to bring the button back.
  // import { startTour } from '../lib/tour.js';
  import { banks as bankPreviewStore } from '../lib/bankPreviewStore.js';
  import {
    addCategory as addCategoryHelper,
    renameCategory as renameCategoryHelper,
    updateCategoryPlanned as updateCategoryPlannedHelper,
    deleteCategory as deleteCategoryHelper,
  } from '../lib/categories.js';
  import ManageBanksSheet from './ManageBanksSheet.svelte';

  let manageBanksOpen = $state(false);

  let tmpl = $derived($template);
  let month = $derived($currentMonth);
  let bufferPlanned = $derived(month ? computeBufferPlanned(month) : 0);
  let bufferLabels = $derived(tmpl?.bufferLabels ?? BUFFER_LABEL_PRESETS);
  let importing = $state(false);
  let pendingImportFile = $state(null);
  let additionalIncomeAmount = $state('');
  let additionalIncomeNote = $state('');
  let newBufferLabel = $state('');
  let newCategoryName = $state('');

  // additionalIncome itself stays the plain summed total everywhere else in
  // the app (calc.js, History, etc. all just read a number) -- this log is
  // the editable source of truth going forward. A month that already had a
  // total before this log existed gets a single synthetic legacy entry so
  // it's immediately editable/deletable instead of silently stuck.
  let additionalIncomeEntries = $derived.by(() => {
    if (!month) return [];
    if (month.additionalIncomeLog?.length) return month.additionalIncomeLog;
    if (month.additionalIncome > 0) return [{ date: month.startedAt || null, amount: month.additionalIncome, legacy: true }];
    return [];
  });

  let editingAiIdx = $state(null);
  let editAiAmount = $state('');
  let editAiNote = $state('');

  async function saveAdditionalIncomeLog(log) {
    const total = round2(log.reduce((s, e) => s + (e.amount || 0), 0));
    await db.months.update(month.key, { additionalIncomeLog: log, additionalIncome: total });
  }

  async function updateName(e) {
    const value = e.target.value.trim();
    await db.meta.put({ key: 'userName', value });
  }

  async function addAdditionalIncome() {
    const amt = parseFloat(additionalIncomeAmount);
    if (!amt) {
      showToast('Enter an amount first');
      return;
    }
    const log = [...additionalIncomeEntries, { date: new Date().toISOString(), amount: amt, note: additionalIncomeNote.trim() || undefined }];
    await saveAdditionalIncomeLog(log);
    additionalIncomeAmount = '';
    additionalIncomeNote = '';
    showToast(`Added RM ${fmt(amt)} additional income`);
  }

  function startEditAi(idx) {
    editingAiIdx = idx;
    editAiAmount = String(additionalIncomeEntries[idx].amount);
    editAiNote = additionalIncomeEntries[idx].note || '';
  }
  async function commitEditAi() {
    const amt = parseFloat(editAiAmount);
    if (!amt) return showToast('Enter an amount first');
    const log = additionalIncomeEntries.map((e, i) =>
      i === editingAiIdx ? { date: e.date, amount: amt, note: editAiNote.trim() || undefined } : e
    );
    await saveAdditionalIncomeLog(log);
    editingAiIdx = null;
  }
  async function deleteAi(idx) {
    const log = additionalIncomeEntries.filter((_, i) => i !== idx);
    await saveAdditionalIncomeLog(log);
    showToast('Removed');
  }
  function formatAiDate(iso) {
    if (!iso) return 'Before tracking';
    const d = new Date(iso);
    return isNaN(d) ? 'Before tracking' : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
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

  async function updateCategoryPlanned(index, e) {
    const value = parseFloat(e.target.value) || tmpl.categories[index].planned;
    e.target.value = value ? value.toFixed(2) : '';
    await updateCategoryPlannedHelper(tmpl, month, index, value);
  }

  // Renaming is safe even for Saving: the pool/Goals link is keyed on `key`
  // ('saving'), never the display name, so the label can be anything.
  async function renameCategory(index, e) {
    const ok = await renameCategoryHelper(tmpl, month, index, e.target.value);
    if (!ok) e.target.value = tmpl.categories[index].name;
  }

  // Deleting removes the category from the template and the current open month
  // (closed months keep their frozen copy). Saving is protected -- it feeds the
  // Goals pool and the savings flow, so it can never be deleted.
  let confirmDeleteKey = $state(null);
  async function deleteCategory(index) {
    const result = await deleteCategoryHelper(tmpl, month, index);
    confirmDeleteKey = null;
    if (result.blocked) return showToast("Saving feeds your Goals — it can't be deleted");
    showToast(`Removed ${result.name}`);
  }

  async function addCategory() {
    const cat = await addCategoryHelper(tmpl, month, newCategoryName);
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

  async function renameBufferLabel(index, e) {
    const value = e.target.value.trim();
    if (!value) {
      e.target.value = bufferLabels[index];
      return;
    }
    const updated = bufferLabels.map((l, i) => (i === index ? value : l));
    await db.template.put({ ...tmpl, bufferLabels: updated });
  }

  async function deleteBufferLabel(index) {
    const updated = bufferLabels.filter((_, i) => i !== index);
    await db.template.put({ ...tmpl, bufferLabels: updated });
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
</script>

<h2 class="title">Commitments setup</h2>
<p class="sub">Fixed categories reappear every month automatically. Buffer gets one pooled budget.</p>

<div class="section-hd" style="margin-top:6px;"><h3>Profile</h3></div>
<div class="card" style="display:flex; align-items:center; justify-content:space-between;">
  <span style="font-size:13.5px; color:var(--lo);">Your name</span>
  <input class="cat-name-input" style="text-align:right; flex:0 1 auto; width:140px;" value={$userName} placeholder="e.g. Wafiq" onchange={updateName} />
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

  <div class="section-hd"><h3>Additional income</h3><span>this cycle</span></div>
  <div class="card">
    <div class="set-row" style="border:none;">
      <span style="flex:1; font-size:13.5px; color:var(--lo);">Added so far this month</span>
      <span class="num" style="font-weight:700; color:var(--good);">RM {fmt(month.additionalIncome || 0)}</span>
    </div>
    <p class="hint" style="margin:2px 0 10px;">For money received mid-cycle (freelance, gift, refund) — counts the same way a start-of-cycle bonus does, flowing straight into Buffer.</p>

    {#each additionalIncomeEntries as e, i (i)}
      {#if editingAiIdx === i}
        <div class="tx-edit">
          <input class="note-input num" bind:value={editAiAmount} inputmode="decimal" placeholder="0.00" />
          <input class="note-input" bind:value={editAiNote} placeholder="Note (optional)" />
          <div style="display:flex; gap:8px;">
            <button class="io-btn" style="flex:1;" onclick={() => (editingAiIdx = null)}>Cancel</button>
            <button class="save-btn" style="flex:1; margin-top:0;" onclick={commitEditAi}>Save</button>
          </div>
        </div>
      {:else}
        <div class="tx-row">
          <div>
            <div class="tx-note-main">{e.note || 'Additional income'}</div>
            <div class="tx-date">{formatAiDate(e.date)}</div>
          </div>
          <span class="num tx-amt" style="color:var(--good);">+RM {fmt(e.amount)}</span>
          <button class="icon-btn small" aria-label="Edit additional income" onclick={() => startEditAi(i)}>
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
          </button>
          <button class="icon-btn small" aria-label="Delete additional income" onclick={() => deleteAi(i)}>
            <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        </div>
      {/if}
    {/each}

    <div style="display:flex; gap:8px; margin-top:10px;">
      <input class="note-input num" placeholder="0.00" inputmode="decimal" bind:value={additionalIncomeAmount} style="flex:1;" />
      <button class="io-btn" style="width:auto; padding-left:16px; padding-right:16px; background:var(--good); color:#fff;" onclick={addAdditionalIncome}>Add</button>
    </div>
    <input class="note-input" placeholder="Note (optional)" bind:value={additionalIncomeNote} style="margin-top:8px;" />
  </div>
{/if}

{#if tmpl}
  <div class="section-hd"><h3>Fixed categories</h3><span>tap a name to rename</span></div>
  <div class="card" data-guide="settings-categories">
    {#each tmpl.categories as cat, i (cat.key)}
      <div class="set-row">
        <span class="dot" style="background:{cat.color}"></span>
        <input class="cat-name-input" value={cat.name} onchange={(e) => renameCategory(i, e)} />
        <input class="set-amt" value={cat.planned ? cat.planned.toFixed(2) : ''} placeholder="0.00" onchange={(e) => updateCategoryPlanned(i, e)} />
        {#if cat.key === 'saving'}
          <span class="cat-lock" title="Feeds your Goals pool — protected">
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15"><rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          </span>
        {:else}
          <button class="cat-del" aria-label="Delete category" onclick={() => (confirmDeleteKey = cat.key)}>
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        {/if}
      </div>
      {#if confirmDeleteKey === cat.key}
        <div class="del-confirm">
          <span>Remove "{cat.name}" and its entries this month?</span>
          <div style="display:flex; gap:8px; margin-top:8px;">
            <button class="io-btn" style="flex:1;" onclick={() => (confirmDeleteKey = null)}>Cancel</button>
            <button class="save-btn danger" style="flex:1; margin-top:0;" onclick={() => deleteCategory(i)}>Remove</button>
          </div>
        </div>
      {/if}
    {/each}
    <div style="display:flex; gap:8px; margin-top:10px;">
      <input class="note-input" placeholder="New category, e.g. Insurance" bind:value={newCategoryName} style="flex:1;" onkeydown={(e) => e.key === 'Enter' && addCategory()} />
      <button class="io-btn" style="width:auto; padding-left:16px; padding-right:16px; background:var(--good); color:#fff;" onclick={addCategory}>Add</button>
    </div>
  </div>
  <p class="hint" style="margin-left:4px;">Saving feeds your Goals pool (it's protected from deletion) — change it here and it applies from next month.</p>

  <div class="section-hd"><h3>Buffer</h3><span>auto-computed</span></div>
  <div class="card" data-guide="settings-buffer">
    <div class="set-row" style="border:none;">
      <span class="dot" style="background:var(--c-buffer)"></span>
      <span class="lbl2">This month's Buffer allocation</span>
      <span class="num" style="font-weight:700; font-size:14px;">{fmt(bufferPlanned)}</span>
    </div>
    <p class="hint" style="margin-top:4px;">= Income − fixed commitments (Income already includes rolled-forward balance, Salary, bonus, and additional income). No need to set this — it's recalculated every month.</p>
  </div>

  <div class="section-hd"><h3>Buffer labels</h3><span>tap a name to rename</span></div>
  <div class="card" data-guide="settings-buffer-labels">
    {#each bufferLabels as label, i (label)}
      <div class="set-row">
        <input class="cat-name-input buffer-label-input" value={label} onchange={(e) => renameBufferLabel(i, e)} />
        <button class="cat-del" aria-label="Delete label" onclick={() => deleteBufferLabel(i)}>
          <svg viewBox="0 0 24 24" fill="none" width="15" height="15"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
    {:else}
      <p class="hint" style="margin:2px 0;">No labels yet — add one below.</p>
    {/each}
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

<!-- Bumped by hand on every push -- check this against what you were told
     to expect to confirm the installed app actually picked up the latest
     deploy, not a stale cached build. -->
<p class="hint" style="text-align:center; margin-top:22px;">BajetBro v{__APP_VERSION__}</p>

<ManageBanksSheet open={manageBanksOpen} onClose={() => (manageBanksOpen = false)} />

<style>
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
  .cat-del,
  .cat-lock {
    background: none;
    border: none;
    padding: 4px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
  }
  .cat-del { color: var(--dim); }
  .cat-lock { color: var(--gold); }
  .del-confirm {
    padding: 12px 6px 6px;
    font-size: 12.5px;
    color: var(--lo);
    border-bottom: 1px solid var(--stroke);
  }
  .save-btn.danger { background: var(--red); color: #2a0709; }
  .tx-row { display: flex; align-items: center; gap: 8px; padding: 10px 4px; border-bottom: 1px solid var(--stroke); }
  .tx-row:last-child { border-bottom: none; }
  .tx-row > div:first-child { flex: 1; min-width: 0; }
  .tx-note-main { font-size: 13.5px; font-weight: 600; color: var(--hi); }
  .tx-date { font-size: 11px; color: var(--dim); font-family: var(--mono); margin-top: 2px; }
  .tx-amt { font-weight: 600; }
  .icon-btn.small { width: 28px; height: 28px; }
  .icon-btn.small + .icon-btn.small { margin-left: 6px; }
  .tx-edit { padding: 10px 4px; border-bottom: 1px solid var(--stroke); display: flex; flex-direction: column; gap: 8px; }
  .tx-edit:last-child { border-bottom: none; }
</style>
