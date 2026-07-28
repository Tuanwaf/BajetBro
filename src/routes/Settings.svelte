<script>
  import { template } from '../lib/stores.js';
  import db from '../lib/db.js';
  import { exportBackup, importBackup } from '../lib/backup.js';

  let tmpl = $derived($template);
  let importing = $state(false);
  let persisted = $state(null);

  if (navigator.storage?.persisted) {
    navigator.storage.persisted().then((v) => (persisted = v));
  }

  async function updateCategory(index, field, value) {
    const updated = tmpl.categories.map((c, i) =>
      i === index ? { ...c, [field]: field === 'planned' ? Number(value) : value } : c
    );
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
      alert('Import complete.');
    } catch (err) {
      alert('Import failed: ' + err.message);
    } finally {
      importing = false;
      e.target.value = '';
    }
  }
</script>

<h1>Settings</h1>

{#if tmpl}
  <section class="template-editor">
    <h2>Fixed Categories</h2>
    {#each tmpl.categories as cat, i (cat.name)}
      <div class="template-row">
        <span class="dot" style="background:{cat.color}"></span>
        <input
          class="name-input"
          value={cat.name}
          onchange={(e) => updateCategory(i, 'name', e.target.value)}
        />
        <input
          class="planned-input"
          type="number"
          step="0.01"
          value={cat.planned}
          onchange={(e) => updateCategory(i, 'planned', e.target.value)}
        />
      </div>
    {/each}
    <p class="hint">Changes here only affect future months — past months keep their own snapshot.</p>
  </section>
{/if}

<section class="backup">
  <h2>Backup</h2>
  <button class="export-btn" onclick={exportBackup}>Export JSON</button>
  <label class="import-btn">
    Import JSON
    <input
      type="file"
      accept="application/json"
      onchange={handleImport}
      disabled={importing}
      style="display:none"
    />
  </label>
  {#if persisted !== null}
    <p class="hint">Persistent storage: {persisted ? 'granted' : 'not granted'}</p>
  {/if}
</section>

<style>
  h1 {
    color: #e6e6ea;
  }
  h2 {
    color: #e6e6ea;
    font-size: 1rem;
  }
  .template-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.4rem 0;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .name-input {
    flex: 1;
    background: #1a1a22;
    border: 1px solid #26262f;
    border-radius: 6px;
    color: #e6e6ea;
    padding: 0.3rem 0.5rem;
  }
  .planned-input {
    width: 90px;
    background: #1a1a22;
    border: 1px solid #26262f;
    border-radius: 6px;
    color: #e6e6ea;
    padding: 0.3rem 0.5rem;
  }
  .hint {
    color: #8a8a99;
    font-size: 0.8rem;
  }
  .backup {
    margin-top: 2rem;
  }
  .export-btn,
  .import-btn {
    display: inline-block;
    padding: 0.6rem 1rem;
    border-radius: 8px;
    background: #1a1a22;
    border: 1px solid #26262f;
    color: #e6e6ea;
    margin-right: 0.5rem;
    cursor: pointer;
  }
</style>
