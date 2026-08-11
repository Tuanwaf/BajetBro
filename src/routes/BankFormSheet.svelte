<script>
  import { GOAL_COLORS } from '../lib/constants.js';
  import { showToast } from '../lib/toast.js';
  import { sheetPageCount } from '../lib/viewStore.js';
  import BankFormFields from '../lib/components/BankFormFields.svelte';

  // One form for both add and edit -- `initial` seeds the fields (defaults
  // for add, the target bank's current values for edit); onSubmit gets the
  // same {name, balance, type, isMain, color, icon, logo, design} shape
  // either way. onDelete is only passed (and only shown) in edit mode. The
  // actual fields live in BankFormFields.svelte, shared with OnboardingFlow's
  // bank step -- this component just owns the sheet chrome + Save/Delete.
  //
  // Doesn't participate in openSheetCount (see viewStore.js) -- that counter
  // only exists to hide the page BEHIND a position:fixed sheet while the
  // keyboard is up (see app.css's .view rule). This is a .sheet-page now,
  // not a fixed overlay -- it shares the root document scroll directly, and
  // whatever it's swapped in for (ManageBanksSheet's own content) is already
  // fully display:none, not just visually covered. Counting this here would
  // collapse .view -- which this sheet's own content now lives inside --
  // the moment its keyboard opened. Registers on sheetPageCount instead, so
  // the tab bar hides while this is showing.
  let { open, mode = 'add', initial = null, otherBanks = [], onClose, onSubmit, onDelete } = $props();

  $effect(() => {
    if (!open) return;
    sheetPageCount.update((n) => n + 1);
    return () => sheetPageCount.update((n) => n - 1);
  });

  // Deleting is a real, unrecoverable data-loss action -- every entry that
  // named this bank stays as-is but loses its "via <bank>" tag -- so it
  // always needs an explicit second confirmation, not a single tap.
  // Deleting the MAIN bank specifically is a bigger deal than a regular one:
  // every place that falls back to "the main bank" when nothing else is
  // picked (AddExpenseSheet's default Paid-from, EndMonthSheet's salary
  // deposit) would otherwise silently start using banksList[0] instead --
  // whichever bank happens to sort first, not a real choice. So on top of
  // the confirmation, deleting the main bank requires picking which other
  // bank becomes the new main one in the same step -- see deleteBank's
  // promoteMainId param (bankPreviewStore.js) for where that lands.
  let deleteConfirmOpen = $state(false);
  let newMainBankId = $state(null);
  let deleteBlocked = $derived(isMain && otherBanks.length > 0 && !newMainBankId);

  let name = $state('');
  let balance = $state('');
  let fixedDeposit = $state('');
  let type = $state('bank');
  let isMain = $state(false);
  let color = $state(GOAL_COLORS[0]);
  let icon = $state(null);
  let logo = $state(null);
  let design = $state('classic');
  // Income/spending aren't editable here (they come from transactions, not
  // this form) -- carried through only so the preview card can show real
  // numbers in edit mode instead of always reading 0.
  let income = $state(0);
  let spending = $state(0);

  $effect(() => {
    if (!open) return;
    name = initial?.name ?? '';
    balance = initial?.balance != null ? String(initial.balance) : '';
    fixedDeposit = initial?.fixedDeposit ? String(initial.fixedDeposit) : '';
    type = initial?.type ?? 'bank';
    isMain = initial?.isMain ?? false;
    color = initial?.color ?? GOAL_COLORS[0];
    icon = initial?.icon ?? null;
    logo = initial?.logo ?? null;
    design = initial?.design ?? 'classic';
    income = initial?.income ?? 0;
    spending = initial?.spending ?? 0;
    deleteConfirmOpen = false;
    newMainBankId = null;
  });

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return showToast('Enter a name first');
    onSubmit({ name: trimmed, balance: Number(balance) || 0, fixedDeposit: Number(fixedDeposit) || 0, type, isMain, color, icon, logo, design });
  }
</script>

<div class="sheet-page" class:open>
  <div class="sheet-page-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>{mode === 'add' ? 'Add bank' : 'Edit bank'}</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-page-body">
    <BankFormFields
      bind:name
      bind:balance
      bind:fixedDeposit
      bind:type
      bind:isMain
      bind:color
      bind:icon
      bind:logo
      bind:design
      {income}
      {spending}
      onEnter={commit}
    />

    {#if deleteConfirmOpen}
      <div class="delete-warn" class:main-warn={isMain}>
        {#if isMain}
          <p class="warn-text">
            <strong>{name.trim() || 'This bank'} is your main bank</strong> — salary and other defaults use it when nothing else is picked. Deleting it can't be undone.
          </p>
          {#if otherBanks.length}
            <p class="warn-text">Pick which bank becomes your new main bank:</p>
            <div class="chip-grid">
              {#each otherBanks as b (b.bank.id)}
                <button class="chip" class:selected={newMainBankId === b.bank.id} onclick={() => (newMainBankId = b.bank.id)}>{b.bank.name}</button>
              {/each}
            </div>
          {/if}
        {:else}
          <p class="warn-text">Delete {name.trim() || 'this bank'}? This can't be undone.</p>
        {/if}
        <div style="display:flex; gap:8px; margin-top:12px;">
          <button class="io-btn" style="flex:1;" onclick={() => { deleteConfirmOpen = false; newMainBankId = null; }}>Cancel</button>
          <button class="io-btn danger" style="flex:1;" disabled={deleteBlocked} onclick={() => onDelete(newMainBankId)}>Confirm delete</button>
        </div>
      </div>
    {:else}
      <button class="save-btn" onclick={commit}>{mode === 'add' ? 'Add bank' : 'Save changes'}</button>
      {#if mode === 'edit' && onDelete}
        <button class="io-btn danger" style="margin-top:10px;" onclick={() => (deleteConfirmOpen = true)}>Remove this bank</button>
      {/if}
    {/if}
  </div>
</div>

<style>
  .io-btn.danger { background: var(--red-dim); color: var(--red); border-color: var(--red); font-weight: 700; }
  .io-btn.danger:disabled { opacity: 0.4; }

  .delete-warn {
    margin-top: 10px;
    padding: 14px 16px;
    border: 2px solid var(--red);
    border-radius: 16px;
    background: var(--red-dim);
  }
  /* Deleting the main bank gets a visibly heavier warning than a regular
     one -- thicker border + a hard shadow, same "raise the stakes" visual
     language the app already uses for primary vs. secondary actions
     elsewhere (card/box-shadow weight), not a new one-off treatment. */
  .delete-warn.main-warn {
    border-width: 3px;
    box-shadow: 3px 3px 0 var(--red);
  }
  .warn-text { font-size: 13px; font-weight: 600; color: var(--red); line-height: 1.45; margin: 0 0 8px; }
  .warn-text:last-of-type { margin-bottom: 0; }
  .delete-warn .chip-grid { margin-top: 4px; }
</style>
