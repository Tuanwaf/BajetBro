<script>
  import { loans } from '../lib/stores.js';
  import { round2 } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import db from '../lib/db.js';

  let { open, onClose } = $props();

  let list = $derived(($loans ?? []).slice().sort((a, b) => new Date(b.date) - new Date(a.date)));
  // Purely informational -- never feeds into any budget/expense calculation.
  // Kept as two separate totals (not netted against each other) per preference.
  let lentTotal = $derived(round2(list.filter((l) => l.direction === 'lent').reduce((s, l) => s + l.amount, 0)));
  let owedTotal = $derived(round2(list.filter((l) => l.direction === 'borrowed').reduce((s, l) => s + l.amount, 0)));

  let adding = $state(false);
  let newPerson = $state('');
  let newAmount = $state('');
  let newDirection = $state('lent');
  let newNote = $state('');

  let editingId = $state(null);
  let editPerson = $state('');
  let editAmount = $state('');
  let editDirection = $state('lent');
  let editNote = $state('');

  function startAdd() {
    adding = true;
    newPerson = '';
    newAmount = '';
    newDirection = 'lent';
    newNote = '';
  }

  async function commitAdd() {
    const amount = parseFloat(newAmount);
    const person = newPerson.trim();
    if (!person) return showToast('Enter who the loan is with');
    if (!amount) return showToast('Enter an amount first');
    await db.loans.add({
      person,
      amount: round2(amount),
      direction: newDirection,
      note: newNote.trim() || undefined,
      date: new Date().toISOString(),
    });
    adding = false;
    showToast(`Logged · ${newDirection === 'lent' ? 'lent to' : 'borrowed from'} ${person}`);
  }

  function startEdit(l) {
    editingId = l.id;
    editPerson = l.person;
    editAmount = String(l.amount);
    editDirection = l.direction;
    editNote = l.note || '';
  }

  async function commitEdit() {
    const amount = parseFloat(editAmount);
    const person = editPerson.trim();
    if (!person) return showToast('Enter who the loan is with');
    if (!amount) return showToast('Enter an amount first');
    await db.loans.update(editingId, {
      person,
      amount: round2(amount),
      direction: editDirection,
      note: editNote.trim() || undefined,
    });
    editingId = null;
  }

  async function deleteLoan(id) {
    await db.loans.delete(id);
    showToast('Removed');
  }

  function formatDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
  }
</script>

<div class="sheet" class:open>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>Loan log</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-body">
    <div class="loan-summary">
      <div class="card loan-stat" style="border-color:var(--good); box-shadow: 4px 4px 0 var(--good);">
        <span style="font-size:12px; color:var(--lo); font-weight:600;">Net you lent</span>
        <span class="num" style="font-size:18px; font-weight:700; color:var(--good);">RM {fmt(lentTotal)}</span>
      </div>
      <div class="card loan-stat" style="border-color:var(--red); box-shadow: 4px 4px 0 var(--red);">
        <span style="font-size:12px; color:var(--lo); font-weight:600;">Net you owe</span>
        <span class="num" style="font-size:18px; font-weight:700; color:var(--red);">RM {fmt(owedTotal)}</span>
      </div>
    </div>

    <div class="field-lbl" style="margin-top:0;">Entries · tap ✎ to fix</div>
    <div class="card">
      {#each list as l (l.id)}
        {#if editingId === l.id}
          <div class="tx-edit">
            <div class="chip-grid">
              <button class="chip ghost" class:selected={editDirection === 'lent'} style={editDirection === 'lent' ? 'color:var(--good)' : ''} onclick={() => (editDirection = 'lent')}>Loan to someone</button>
              <button class="chip ghost" class:selected={editDirection === 'borrowed'} style={editDirection === 'borrowed' ? 'color:#f2a154' : ''} onclick={() => (editDirection = 'borrowed')}>Loan from someone</button>
            </div>
            <input class="note-input" bind:value={editPerson} placeholder="Person's name" />
            <input class="note-input num" bind:value={editAmount} inputmode="decimal" placeholder="0.00" />
            <input class="note-input" bind:value={editNote} placeholder="Note (optional)" />
            <div style="display:flex; gap:8px;">
              <button class="io-btn" style="flex:1;" onclick={() => (editingId = null)}>Cancel</button>
              <button class="save-btn" style="flex:1; margin-top:0;" onclick={commitEdit}>Save</button>
            </div>
          </div>
        {:else}
          <div class="tx-row">
            <div>
              <div class="tx-note-main">{l.person}</div>
              <div class="tx-date">{l.direction === 'lent' ? 'You lent' : 'You borrowed'} · {formatDate(l.date)}{l.note ? ` · ${l.note}` : ''}</div>
            </div>
            <span class="num tx-amt" style="color:{l.direction === 'lent' ? 'var(--good)' : 'var(--red)'};">RM {fmt(l.amount)}</span>
            <button class="icon-btn small" aria-label="Edit loan" onclick={() => startEdit(l)}>
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
            </button>
            <button class="icon-btn small" aria-label="Delete loan" onclick={() => deleteLoan(l.id)}>
              <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        {/if}
      {:else}
        <p class="hint" style="margin:2px 0;">No loans logged yet.</p>
      {/each}
    </div>

    {#if adding}
      <div class="card" style="margin-top:12px;">
        <div class="tx-edit" style="border-bottom:none; padding-top:0;">
          <div class="chip-grid">
            <button class="chip ghost" class:selected={newDirection === 'lent'} style={newDirection === 'lent' ? 'color:var(--good)' : ''} onclick={() => (newDirection = 'lent')}>Loan to someone</button>
            <button class="chip ghost" class:selected={newDirection === 'borrowed'} style={newDirection === 'borrowed' ? 'color:#f2a154' : ''} onclick={() => (newDirection = 'borrowed')}>Loan from someone</button>
          </div>
          <input class="note-input" bind:value={newPerson} placeholder="Person's name" />
          <input class="note-input num" bind:value={newAmount} inputmode="decimal" placeholder="0.00" />
          <input class="note-input" bind:value={newNote} placeholder="Note (optional)" />
          <div style="display:flex; gap:8px;">
            <button class="io-btn" style="flex:1;" onclick={() => (adding = false)}>Cancel</button>
            <button class="save-btn" style="flex:1; margin-top:0;" onclick={commitAdd}>Add</button>
          </div>
        </div>
      </div>
    {:else}
      <button class="io-btn add-loan-btn" onclick={startAdd}>
        <svg viewBox="0 0 24 24" fill="none" width="16" height="16"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        Log a loan
      </button>
    {/if}

    <p class="hint">Purely a manual record of who owes who — never touches your balance, Spent, or any budget calculation. Delete an entry once it's settled.</p>
  </div>
</div>

<style>
  .loan-summary { display: flex; gap: 10px; margin-bottom: 14px; }
  .loan-stat { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .add-loan-btn { margin-top: 12px; background: var(--gold); border-color: var(--stroke-2); color: var(--accent-ink); }
  .tx-row { display: flex; align-items: center; gap: 8px; padding: 10px 4px; border-bottom: 1px solid var(--stroke); }
  .tx-row:last-child { border-bottom: none; }
  .tx-row > div:first-child { flex: 1; min-width: 0; }
  .tx-note-main { font-size: 13.5px; font-weight: 600; color: var(--hi); }
  .tx-date { font-size: 11px; color: var(--dim); font-family: var(--mono); margin-top: 2px; }
  .tx-amt { font-weight: 600; }
  .icon-btn.small { width: 28px; height: 28px; }
  .icon-btn.small + .icon-btn.small { margin-left: 6px; }
  .tx-edit { padding: 10px 0; border-bottom: 1px solid var(--stroke); display: flex; flex-direction: column; gap: 8px; }
  .tx-edit:last-child { border-bottom: none; }
</style>
