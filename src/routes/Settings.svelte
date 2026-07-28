<script>
  import { template, currentMonth } from '../lib/stores.js';
  import { computeAdhocPlanned } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import db from '../lib/db.js';
  import { exportBackup, importBackup } from '../lib/backup.js';

  let tmpl = $derived($template);
  let month = $derived($currentMonth);
  let adhocPlanned = $derived(month && tmpl ? computeAdhocPlanned(month, tmpl) : 0);
  let importing = $state(false);

  async function updateIncome(e) {
    const value = parseFloat(e.target.value) || month.income;
    e.target.value = value.toFixed(2);
    await db.months.update(month.key, { income: value });
  }

  async function updateCategoryPlanned(index, e) {
    const value = parseFloat(e.target.value) || tmpl.categories[index].planned;
    e.target.value = value.toFixed(2);
    const updated = tmpl.categories.map((c, i) => (i === index ? { ...c, planned: value } : c));
    await db.template.put({ ...tmpl, categories: updated });
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (!confirm('Importing will replace all current local data. Continue?')) {
      e.target.value = '';
      return;
    }
    importing = true;
    try {
      await importBackup(file);
      showToast('Backup restored');
    } catch (err) {
      showToast('That file could not be read — is it a BajetBro export?');
    } finally {
      importing = false;
      e.target.value = '';
    }
  }

  async function handleExport() {
    await exportBackup();
    showToast('Exported — save this file somewhere safe');
  }
</script>

<h2 class="title">Commitments setup</h2>
<p class="sub">Fixed categories reappear every month automatically. Ad-hoc gets one pooled budget.</p>

{#if month}
  <div class="section-hd" style="margin-top:6px;"><h3>Net income baseline</h3></div>
  <div class="card" style="display:flex; align-items:center; justify-content:space-between;">
    <span style="font-size:13.5px; color:var(--lo);">Monthly net income</span>
    <input class="set-amt" style="width:100px;" value={month.income.toFixed(2)} onchange={updateIncome} />
  </div>
{/if}

{#if tmpl}
  <div class="section-hd"><h3>Fixed categories</h3><span>{tmpl.categories.length} active</span></div>
  <div class="card">
    {#each tmpl.categories as cat, i (cat.key)}
      <div class="set-row">
        <span class="dot" style="background:{cat.color}"></span>
        <span class="lbl2">{cat.name}</span>
        <input class="set-amt" value={cat.planned.toFixed(2)} onchange={(e) => updateCategoryPlanned(i, e)} />
      </div>
    {/each}
  </div>
  <p class="hint" style="margin-left:4px;">Saving feeds your Hutang pot — change it here and it applies from next month.</p>
  <button class="add-cat-btn">+ Add fixed category</button>

  <div class="section-hd"><h3>Ad-hoc</h3><span>auto-computed</span></div>
  <div class="card">
    <div class="set-row" style="border:none;">
      <span class="dot" style="background:var(--c-adhoc)"></span>
      <span class="lbl2">This month's Ad-hoc allocation</span>
      <span class="num" style="font-weight:700; font-size:14px;">{fmt(adhocPlanned)}</span>
    </div>
    <p class="hint" style="margin-top:4px;">= Income − fixed commitments, plus any bonus. No need to set this — it's recalculated every month.</p>
  </div>
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
    <input type="file" accept="application/json" onchange={handleImport} disabled={importing} style="display:none" />
  </label>
  <p class="hint">Everything — commitments, this cycle, Hutang pots, dividends — bundles into one file. Import it on your next device to pick up exactly where you left off.</p>
</div>
