<script>
  import { GOAL_COLORS } from '../lib/constants.js';
  import { showToast } from '../lib/toast.js';
  import BankFormFields from '../lib/components/BankFormFields.svelte';

  // One form for both add and edit -- `initial` seeds the fields (defaults
  // for add, the target bank's current values for edit); onSubmit gets the
  // same {name, balance, type, isMain, color, icon, logo, design} shape
  // either way. onDelete is only passed (and only shown) in edit mode. The
  // actual fields live in BankFormFields.svelte, shared with OnboardingFlow's
  // bank step -- this component just owns the sheet chrome + Save/Delete.
  let { open, mode = 'add', initial = null, onClose, onSubmit, onDelete } = $props();

  let name = $state('');
  let balance = $state('');
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
    type = initial?.type ?? 'bank';
    isMain = initial?.isMain ?? false;
    color = initial?.color ?? GOAL_COLORS[0];
    icon = initial?.icon ?? null;
    logo = initial?.logo ?? null;
    design = initial?.design ?? 'classic';
    income = initial?.income ?? 0;
    spending = initial?.spending ?? 0;
  });

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) return showToast('Enter a name first');
    onSubmit({ name: trimmed, balance: Number(balance) || 0, type, isMain, color, icon, logo, design });
  }
</script>

<div class="sheet" class:open>
  <div class="sheet-hd">
    <button class="icon-btn" aria-label="Close" onclick={onClose}>
      <svg width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <h2>{mode === 'add' ? 'Add bank' : 'Edit bank'}</h2>
    <span style="width:38px;"></span>
  </div>
  <div class="sheet-body">
    <BankFormFields
      bind:name
      bind:balance
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

    <button class="save-btn" onclick={commit}>{mode === 'add' ? 'Add bank' : 'Save changes'}</button>
    {#if mode === 'edit' && onDelete}
      <button class="io-btn danger" style="margin-top:10px;" onclick={onDelete}>Remove this bank</button>
    {/if}
  </div>
</div>

<style>
  .io-btn.danger { background: var(--red-dim); color: var(--red); border-color: var(--red); font-weight: 700; }
</style>
