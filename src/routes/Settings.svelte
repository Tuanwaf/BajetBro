<script>
  import { template, currentMonth, userName } from '../lib/stores.js';
  import { computeBufferPlanned, round2 } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import { BUFFER_LABEL_PRESETS } from '../lib/constants.js';
  import db from '../lib/db.js';
  import { exportBackup, importBackup } from '../lib/backup.js';

  let tmpl = $derived($template);
  let month = $derived($currentMonth);
  let bufferPlanned = $derived(month ? computeBufferPlanned(month) : 0);
  let bufferLabels = $derived(tmpl?.bufferLabels ?? BUFFER_LABEL_PRESETS);
  let importing = $state(false);
  let pendingImportFile = $state(null);
  let additionalIncomeAmount = $state('');
  let newBufferLabel = $state('');

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
    await db.months.update(month.key, { additionalIncome: (month.additionalIncome || 0) + amt });
    additionalIncomeAmount = '';
    showToast(`Added RM ${fmt(amt)} additional income`);
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
    e.target.value = value.toFixed(2);
    const key = tmpl.categories[index].key;

    const updatedTemplate = tmpl.categories.map((c, i) => (i === index ? { ...c, planned: value } : c));
    await db.template.put({ ...tmpl, categories: updatedTemplate });

    // The current (open) month is still "in progress" -- its categories
    // should track live template edits too. Only closed/historical months
    // stay frozen.
    if (month) {
      const updatedMonth = month.categories.map((c) => (c.key === key ? { ...c, planned: value } : c));
      await db.months.update(month.key, { categories: updatedMonth });
    }
  }

  // Renaming is safe even for Saving: the pool/Goals link is keyed on `key`
  // ('saving'), never the display name, so the label can be anything.
  async function renameCategory(index, e) {
    const value = e.target.value.trim();
    if (!value) {
      e.target.value = tmpl.categories[index].name;
      return;
    }
    const key = tmpl.categories[index].key;
    const updatedTemplate = tmpl.categories.map((c, i) => (i === index ? { ...c, name: value } : c));
    await db.template.put({ ...tmpl, categories: updatedTemplate });
    if (month) {
      const updatedMonth = month.categories.map((c) => (c.key === key ? { ...c, name: value } : c));
      await db.months.update(month.key, { categories: updatedMonth });
    }
  }

  // Deleting removes the category from the template and the current open month
  // (closed months keep their frozen copy). Saving is protected -- it feeds the
  // Goals pool and the savings flow, so it can never be deleted.
  let confirmDeleteKey = $state(null);
  async function deleteCategory(index) {
    const cat = tmpl.categories[index];
    if (cat.key === 'saving') {
      showToast("Saving feeds your Goals — it can't be deleted");
      confirmDeleteKey = null;
      return;
    }
    const updatedTemplate = tmpl.categories.filter((_, i) => i !== index);
    await db.template.put({ ...tmpl, categories: updatedTemplate });
    if (month) {
      const updatedMonth = month.categories.filter((c) => c.key !== cat.key);
      await db.months.update(month.key, { categories: updatedMonth });
    }
    confirmDeleteKey = null;
    showToast(`Removed ${cat.name}`);
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

{#if month}
  <div class="section-hd" style="margin-top:6px;"><h3>Salary baseline</h3></div>
  <div class="card" style="display:flex; align-items:center; justify-content:space-between;">
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
    <div style="display:flex; gap:8px;">
      <input class="note-input num" placeholder="0.00" inputmode="decimal" bind:value={additionalIncomeAmount} style="flex:1;" />
      <button class="io-btn" style="width:auto; padding-left:16px; padding-right:16px;" onclick={addAdditionalIncome}>Add</button>
    </div>
  </div>
{/if}

{#if tmpl}
  <div class="section-hd"><h3>Fixed categories</h3><span>tap a name to rename</span></div>
  <div class="card">
    {#each tmpl.categories as cat, i (cat.key)}
      <div class="set-row">
        <span class="dot" style="background:{cat.color}"></span>
        <input class="cat-name-input" value={cat.name} onchange={(e) => renameCategory(i, e)} />
        <input class="set-amt" value={cat.planned.toFixed(2)} onchange={(e) => updateCategoryPlanned(i, e)} />
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
  </div>
  <p class="hint" style="margin-left:4px;">Saving feeds your Goals pool (it's protected from deletion) — change it here and it applies from next month.</p>

  <div class="section-hd"><h3>Buffer</h3><span>auto-computed</span></div>
  <div class="card">
    <div class="set-row" style="border:none;">
      <span class="dot" style="background:var(--c-buffer)"></span>
      <span class="lbl2">This month's Buffer allocation</span>
      <span class="num" style="font-weight:700; font-size:14px;">{fmt(bufferPlanned)}</span>
    </div>
    <p class="hint" style="margin-top:4px;">= Income − fixed commitments (Income already includes rolled-forward balance, Salary, bonus, and additional income). No need to set this — it's recalculated every month.</p>
  </div>

  <div class="section-hd"><h3>Buffer labels</h3><span>tap a name to rename</span></div>
  <div class="card">
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
      <button class="io-btn" style="width:auto; padding-left:16px; padding-right:16px;" onclick={addBufferLabel}>Add</button>
    </div>
  </div>
  <p class="hint" style="margin-left:4px;">These are the quick-pick chips shown when logging a Buffer expense — you can still type a one-off custom label there too.</p>
{/if}

<div class="section-hd"><h3>Backup &amp; transfer</h3><span>move to another device</span></div>
<div class="card" style="display:flex; flex-direction:column; gap:10px;">
  <button class="io-btn" onclick={handleExport}>
    <svg viewBox="0 0 24 24" fill="none"><path d="M12 15V3M7 8l5-5 5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Export backup (.json)
  </button>
  <label class="io-btn" style="cursor:pointer;">
    <svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12M7 10l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
    Import backup
    <input type="file" accept=".json,application/json" onchange={handlePickFile} disabled={importing} style="display:none" />
  </label>
  <p class="hint">Everything — commitments, this cycle, goals, dividends — bundles into one file. Import it on your next device to pick up exactly where you left off.</p>
</div>

{#if pendingImportFile}
  <div class="card" style="margin-top:12px; border-color:var(--red);">
    <div class="cat-name-row" style="margin-bottom:8px;"><span>Replace all local data?</span></div>
    <p class="hint" style="margin:0 0 14px;">Importing "{pendingImportFile.name}" will overwrite everything currently stored on this device. This can't be undone.</p>
    <div style="display:flex; gap:10px;">
      <button class="io-btn" style="flex:1;" onclick={cancelImport}>Cancel</button>
      <button class="save-btn" style="flex:1; margin-top:0;" onclick={confirmImport}>Import</button>
    </div>
  </div>
{/if}

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
</style>
