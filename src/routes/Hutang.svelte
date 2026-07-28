<script>
  import { hutangPots, hutangLedger, tabungHaji, dividends } from '../lib/stores.js';
  import {
    computeOpenPots,
    computeSettledPots,
    computePersonalSavings,
    computeHutangLedgerRemain,
    computeHutangTotalSend,
    computeTabungHajiTotal,
    computeDividendsTotal,
  } from '../lib/calc.js';
  import { fmt } from '../lib/format.js';
  import { showToast } from '../lib/toast.js';
  import db from '../lib/db.js';
  import PotCard from '../lib/components/PotCard.svelte';

  let pots = $derived($hutangPots ?? []);
  let ledger = $derived($hutangLedger);
  let th = $derived($tabungHaji);
  let divs = $derived($dividends ?? []);

  let openPots = $derived(computeOpenPots(pots));
  let settledPots = $derived(computeSettledPots(pots));
  let personalSavings = $derived(computePersonalSavings(pots));
  let ledgerRemain = $derived(ledger ? computeHutangLedgerRemain(ledger, pots) : 0);
  let totalSend = $derived(computeHutangTotalSend(pots));
  let paidPct = $derived(ledger?.initial > 0 ? Math.max(0, Math.min(100, (totalSend / ledger.initial) * 100)) : 0);
  let tabungHajiTotal = $derived(th ? computeTabungHajiTotal(th, pots, divs) : 0);
  let dividendsTotal = $derived(computeDividendsTotal(divs));

  let totInitial = $derived(pots.reduce((s, p) => s + p.initial, 0));
  let totUsed = $derived(pots.reduce((s, p) => s + p.used, 0));
  let totRemain = $derived(totInitial - totUsed - totalSend);

  let dividendFormOpen = $state(false);
  let dividendLabel = $state('');
  let dividendAmount = $state('');

  let editingDividendId = $state(null);
  let editLabel = $state('');
  let editAmount = $state('');

  async function addDividend() {
    const amt = parseFloat(dividendAmount);
    if (!amt) {
      showToast('Enter a dividend amount first');
      return;
    }
    const label = dividendLabel.trim() || `Dividend ${divs.length + 1}`;
    await db.dividends.add({ label, amount: amt, date: new Date().toISOString() });
    dividendFormOpen = false;
    dividendLabel = '';
    dividendAmount = '';
    showToast(`Added ${label} · RM ${fmt(amt)}`);
  }

  function startEditDividend(div) {
    editingDividendId = div.id;
    editLabel = div.label;
    editAmount = String(div.amount);
  }

  function cancelEditDividend() {
    editingDividendId = null;
  }

  async function saveEditDividend() {
    const amt = parseFloat(editAmount);
    if (!amt) {
      showToast('Enter a dividend amount first');
      return;
    }
    await db.dividends.update(editingDividendId, { label: editLabel.trim() || 'Dividend', amount: amt });
    editingDividendId = null;
    showToast('Dividend updated');
  }

  async function deleteDividend(div) {
    await db.dividends.delete(div.id);
    showToast(`Removed ${div.label}`);
  }
</script>

<h2 class="title">Hutang</h2>
<p class="sub">Money owed to Mom — funded by your Saving commitment.</p>

{#if ledger}
  <div class="balance-card">
    <div class="balance-top">
      <div class="lbl">Remaining owed</div>
      <span class="pill gold">RM {fmt(totalSend)} paid</span>
    </div>
    <div class="balance-amt"><span class="cur">RM</span>{fmt(ledgerRemain)}</div>
    <div style="font-size:12px; color:var(--lo); position:relative; z-index:1;">of RM <span class="num">{fmt(ledger.initial)}</span> borrowed</div>
    <div class="progress-track"><div class="progress-fill" style="width:{paidPct}%;"></div></div>
  </div>
{/if}

<div class="card" style="display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;">
  <div>
    <div style="font-size:11.5px; color:var(--lo); font-weight:600;">Unallocated</div>
    <div class="num" style="font-size:19px; font-weight:700; margin-top:2px;">{fmt(personalSavings)}</div>
    <div style="font-size:11px; color:var(--dim); margin-top:2px;">Sitting across open pots — feeds Tabung Haji below</div>
  </div>
</div>

<div class="section-hd"><h3>Open pots</h3><span>pick one when logging</span></div>
{#if openPots.length}
  {#each openPots as pot (pot.month)}
    <PotCard {pot} isOpen={true} />
  {/each}
{:else}
  <p class="hint" style="margin:4px 0;">Nothing open right now — every pot is fully settled.</p>
{/if}
<p class="hint">Any open pot can still receive Used or Send entries — closing a month doesn't force-settle it. Log from the + button and choose which month's pot it comes from.</p>

<div class="section-hd"><h3>Settled</h3><span>fully allocated</span></div>
{#if settledPots.length}
  {#each settledPots as pot (pot.month)}
    <PotCard {pot} isOpen={false} />
  {/each}
{:else}
  <p class="hint" style="margin:4px 0;">No settled pots yet.</p>
{/if}

<div class="section-hd"><h3>Total</h3><span>all tracked months</span></div>
<div class="card">
  <div class="hu-grid">
    <div class="hu-cell"><span class="hu-k" style="color:var(--h-initial)">Initial</span><b class="num">{fmt(totInitial)}</b></div>
    <div class="hu-cell"><span class="hu-k" style="color:var(--h-used)">Used</span><b class="num">{fmt(totUsed)}</b></div>
    <div class="hu-cell"><span class="hu-k" style="color:var(--h-send)">Send</span><b class="num">{fmt(totalSend)}</b></div>
    <div class="hu-cell"><span class="hu-k" style="color:var(--h-remain)">Remain</span><b class="num">{fmt(totRemain)}</b></div>
  </div>
</div>

<div class="section-hd"><h3>Where it grows</h3><span>savings &amp; investments</span></div>

{#if th}
  <div class="balance-card" style="margin-bottom:10px;">
    <div class="balance-top">
      <div class="lbl">Tabung Haji</div>
      <span class="pill good">Active</span>
    </div>
    <div class="balance-amt"><span class="cur">RM</span>{fmt(tabungHajiTotal)}</div>
    <div class="balance-row">
      <div class="stat"><div class="k">Fixed deposit</div><div class="v num">{fmt(th.fixedDeposit)}</div></div>
      <div class="stat"><div class="k">Savings</div><div class="v num">{fmt(personalSavings)}</div></div>
      <div class="stat"><div class="k">Dividend</div><div class="v num up">{fmt(dividendsTotal)}</div></div>
    </div>
    {#if divs.length}
      <div class="dividend-list">
        {#each divs as div (div.id)}
          {#if editingDividendId === div.id}
            <div class="dividend-edit">
              <input class="note-input" placeholder="Label" bind:value={editLabel} />
              <input class="note-input num" placeholder="0.00" inputmode="decimal" bind:value={editAmount} />
              <div style="display:flex; gap:8px;">
                <button class="io-btn" style="flex:1;" onclick={cancelEditDividend}>Cancel</button>
                <button class="save-btn" style="flex:1; margin-top:0;" onclick={saveEditDividend}>Save</button>
              </div>
            </div>
          {:else}
            <div class="dividend-row">
              <span class="dividend-label">{div.label}</span>
              <span class="num" style="margin-right:8px;">RM {fmt(div.amount)}</span>
              <button class="icon-btn small" aria-label="Edit dividend" onclick={() => startEditDividend(div)}>
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
              </button>
              <button class="icon-btn small" aria-label="Delete dividend" onclick={() => deleteDividend(div)}>
                <svg viewBox="0 0 24 24" fill="none" width="14" height="14"><path d="M4 6h16M9 6V4h6v2m-8 0 1 14h8l1-14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </button>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
    <button class="add-dividend-btn" onclick={() => (dividendFormOpen = !dividendFormOpen)}>+ Add dividend</button>
    {#if dividendFormOpen}
      <div style="position:relative; z-index:1;">
        <div class="field-lbl" style="margin-top:12px;">Label</div>
        <input class="note-input" placeholder="e.g. 2026 dividend" bind:value={dividendLabel} />
        <div class="field-lbl">Amount</div>
        <input class="note-input num" placeholder="0.00" inputmode="decimal" bind:value={dividendAmount} />
        <button class="save-btn" style="margin-top:10px;" onclick={addDividend}>Save dividend</button>
      </div>
    {/if}
  </div>
{/if}

<div class="card" style="opacity:0.6; border-style:dashed;">
  <div style="display:flex; justify-content:space-between; align-items:center;">
    <div>
      <div style="font-weight:700; font-size:14px;">ASB</div>
      <div style="font-size:11px; color:var(--dim); margin-top:2px;">Planned · higher historical dividend</div>
    </div>
    <span class="pill neutral">Not started</span>
  </div>
</div>
<p class="hint">Once an ASB account opens, it becomes a second growth vehicle here — same Contribution pattern as Tabung Haji, plus its own yearly Dividend entry.</p>

<style>
  .dividend-list {
    position: relative;
    z-index: 1;
    margin-top: 12px;
  }
  .dividend-row {
    display: flex;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid var(--stroke);
  }
  .dividend-row:last-child {
    border-bottom: none;
  }
  .dividend-label {
    flex: 1;
    font-size: 13px;
    color: var(--hi);
  }
  .icon-btn.small {
    width: 28px;
    height: 28px;
  }
  .dividend-edit {
    padding: 8px 0;
    border-bottom: 1px solid var(--stroke);
  }
  .dividend-edit .note-input {
    margin-bottom: 8px;
  }
</style>
