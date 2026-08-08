<script>
  import { template } from '../lib/stores.js';
  import { GOAL_COLORS, MONTH_NAMES } from '../lib/constants.js';
  import { showToast } from '../lib/toast.js';
  import db from '../lib/db.js';
  import { addBank } from '../lib/bankPreviewStore.js';
  import { buildCategory } from '../lib/categories.js';
  // Guided tour is disabled for now -- see the commented-out call in finish() below.
  // import { startTour } from '../lib/tour.js';
  import BankFormFields from '../lib/components/BankFormFields.svelte';

  let tmpl = $derived($template);

  // Nothing here writes to the database until Finish (step 3's own
  // add/rename/set-value/delete included) -- so going back and forth
  // between steps, or abandoning the flow entirely, never leaves a bank
  // created without a month, or a half-customized template with no month
  // to match it. The one atomic commit at the end is what App.svelte's
  // `!currentMonth` check is actually waiting on to leave this flow.
  let step = $state(1);

  // ---- step 1: name ----
  let obName = $state('');

  // ---- step 2: your main bank + salary ----
  // Same field set as BankFormSheet's add/edit form (via BankFormFields) --
  // this is always the main bank, since onboarding only ever creates the
  // first one. Salary isn't part of that shared component (it's a
  // month-level figure, not a bank field) so it lives here alongside it.
  let bankName = $state('');
  let bankBalance = $state('');
  let bankType = $state('bank');
  let bankIsMain = $state(true);
  let bankColor = $state(GOAL_COLORS[0]);
  let bankIcon = $state(null);
  let bankLogo = $state(null);
  let bankDesign = $state('classic');
  let salary = $state('');

  // ---- step 3: commitments ----
  // Local working copy of the template's categories -- seeded once the
  // template loads, edited locally, only written back to db.template (and
  // folded into the new month) at Finish.
  let categories = $state([]);
  let categoriesSeeded = $state(false);
  let newCategoryName = $state('');
  let confirmDeleteKey = $state(null);

  $effect(() => {
    if (tmpl && !categoriesSeeded) {
      categories = tmpl.categories.map((c) => ({ ...c }));
      categoriesSeeded = true;
    }
  });

  function goToStep2() {
    step = 2;
  }

  function goToStep3() {
    if (!bankName.trim()) return showToast("Enter your bank's name first");
    if (!parseFloat(salary)) return showToast('Enter your salary first');
    step = 3;
  }

  function addCategoryLocal() {
    const newCat = buildCategory(categories, newCategoryName);
    if (!newCat) return;
    categories = [...categories, newCat];
    newCategoryName = '';
  }

  function renameCategoryLocal(index, e) {
    const value = e.target.value.trim();
    if (!value) {
      e.target.value = categories[index].name;
      return;
    }
    categories = categories.map((c, i) => (i === index ? { ...c, name: value } : c));
  }

  function updatePlannedLocal(index, e) {
    const value = parseFloat(e.target.value) || categories[index].planned;
    e.target.value = value ? value.toFixed(2) : '';
    categories = categories.map((c, i) => (i === index ? { ...c, planned: value } : c));
  }

  function deleteCategoryLocal(index) {
    const cat = categories[index];
    if (cat.key === 'saving') {
      showToast("Saving feeds your Goals — it can't be deleted");
      confirmDeleteKey = null;
      return;
    }
    categories = categories.filter((_, i) => i !== index);
    confirmDeleteKey = null;
  }

  async function finish() {
    const salaryNum = parseFloat(salary) || 0;
    // Left at 0 (not typed) = no extra on top of salary, i.e. starting
    // money == salary -- the same "leave it blank" convenience the old
    // 3-field welcome form offered, just via the bank's own Balance field
    // instead of a separate Income field.
    const balanceNum = Number(bankBalance) || salaryNum;

    await addBank({
      name: bankName.trim(),
      balance: balanceNum,
      type: bankType,
      isMain: bankIsMain,
      color: bankColor,
      icon: bankIcon,
      logo: bankLogo,
      design: bankDesign,
    });

    const trimmedName = obName.trim();
    if (trimmedName) await db.meta.put({ key: 'userName', value: trimmedName });

    // `categories` is a $state array -- a reactive Proxy, not a plain
    // array/objects -- and IndexedDB's structured-clone can't serialize a
    // Proxy directly (DataCloneError). Unwrapping it to plain objects here
    // is what every other write path already gets for free, since theirs
    // comes from a $derived(liveQuery) read instead of a local $state.
    const plainCategories = categories.map((c) => ({ ...c }));
    await db.template.put({ ...tmpl, categories: plainCategories });

    const now = new Date();
    const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const label = MONTH_NAMES[now.getMonth()];
    await db.months.put({
      key,
      order: now.getMonth() + 1,
      label,
      closed: 0,
      income: salaryNum,
      bonus: 0,
      additionalIncome: 0,
      startingBalance: balanceNum,
      categories: plainCategories.map((c) => ({ ...c, actual: 0 })),
      extras: [],
      recordedTotal: 0,
      startedAt: now.toISOString(),
    });

    showToast(`${label} started`);

    // Guided tour is disabled for now -- revisit later if still wanted.
    // Same "genuinely fresh install" auto-start the old boot-time trigger
    // used to do, just moved here since the tour can't safely start until
    // this flow has actually produced a month for it to walk through.
    // if (!(await db.meta.get('tourCompleted'))) startTour();
  }
</script>

<div class="onboarding">
  <div class="onboarding-progress">Step {step} of 3</div>

  {#if step === 1}
    <h2 class="title">Welcome 👋</h2>
    <p class="sub">Let's get you set up.</p>
    <div class="card">
      <div class="field-lbl" style="margin-top:0;">Your name <span style="text-transform:none; letter-spacing:0; color:var(--dim); font-weight:600;">optional</span></div>
      <input class="note-input" placeholder="e.g. Wafiq" bind:value={obName} onkeydown={(e) => e.key === 'Enter' && goToStep2()} />
      <p class="hint" style="margin:4px 2px 0;">Just for the greeting on Home. You can set or change this later in Settings anytime.</p>
    </div>
    <button class="save-btn" onclick={goToStep2}>Next</button>
  {:else if step === 2}
    <h2 class="title">Your main bank</h2>
    <p class="sub">Where your salary goes in. You can add more banks later in Settings.</p>
    <BankFormFields
      bind:name={bankName}
      bind:balance={bankBalance}
      bind:type={bankType}
      bind:isMain={bankIsMain}
      bind:color={bankColor}
      bind:icon={bankIcon}
      bind:logo={bankLogo}
      bind:design={bankDesign}
      onEnter={goToStep3}
    />
    <div class="field-lbl">Salary</div>
    <input class="note-input num" placeholder="0.00" inputmode="decimal" bind:value={salary} onkeydown={(e) => e.key === 'Enter' && goToStep3()} />
    <p class="hint" style="margin:4px 2px 14px;">Your monthly salary — you can adjust this later in Settings.</p>
    <div class="onboarding-actions">
      <button class="icon-btn" aria-label="Back" onclick={() => (step = 1)}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 1 3 7l6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="save-btn" style="flex:1; margin-top:0;" onclick={goToStep3}>Next</button>
    </div>
  {:else}
    <h2 class="title">Your commitments</h2>
    <p class="sub">These fixed categories repeat every month — rename them, set what you plan to spend, or add your own.</p>
    <div class="card">
      {#each categories as cat, i (cat.key)}
        <div class="set-row">
          <span class="dot" style="background:{cat.color}"></span>
          <input class="cat-name-input" value={cat.name} onchange={(e) => renameCategoryLocal(i, e)} />
          <input class="set-amt" value={cat.planned ? cat.planned.toFixed(2) : ''} placeholder="0.00" onchange={(e) => updatePlannedLocal(i, e)} />
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
            <span>Remove "{cat.name}"?</span>
            <div style="display:flex; gap:8px; margin-top:8px;">
              <button class="io-btn" style="flex:1;" onclick={() => (confirmDeleteKey = null)}>Cancel</button>
              <button class="save-btn danger" style="flex:1; margin-top:0;" onclick={() => deleteCategoryLocal(i)}>Remove</button>
            </div>
          </div>
        {/if}
      {/each}
      <div style="display:flex; gap:8px; margin-top:10px;">
        <input class="note-input" placeholder="New category, e.g. Insurance" bind:value={newCategoryName} style="flex:1;" onkeydown={(e) => e.key === 'Enter' && addCategoryLocal()} />
        <button class="io-btn" style="width:auto; padding-left:16px; padding-right:16px; background:var(--good); color:#fff;" onclick={addCategoryLocal}>Add</button>
      </div>
    </div>
    <p class="hint" style="margin-left:4px;">Saving feeds your Goals pool (it's protected from deletion) — you can adjust the rest anytime in Settings.</p>
    <div class="onboarding-actions">
      <button class="icon-btn" aria-label="Back" onclick={() => (step = 2)}>
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M9 1 3 7l6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
      <button class="save-btn" style="flex:1; margin-top:0;" onclick={finish}>Start {MONTH_NAMES[new Date().getMonth()]}</button>
    </div>
  {/if}
</div>

<style>
  /* No bottom nav dock here (App.svelte doesn't render TabBar during
     onboarding), so this reuses .view's top safe-area handling but a
     normal small bottom padding instead of .view's dock-clearance reserve. */
  .onboarding {
    min-height: calc(var(--app-vh, 100dvh) * 100);
    padding: calc(env(safe-area-inset-top, 0px) + 16px) 20px calc(env(safe-area-inset-bottom, 0px) + 24px);
    box-sizing: border-box;
  }
  .onboarding-progress {
    font-size: 10.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
    color: var(--gold); margin-bottom: 6px;
  }
  .onboarding-actions { display: flex; align-items: center; gap: 10px; margin-top: 14px; }

  .cat-name-input {
    flex: 1; min-width: 0;
    background: none; border: none; border-bottom: 1px dashed transparent;
    color: var(--hi); font-family: var(--body); font-size: 14px; font-weight: 600;
    padding: 2px 0;
  }
  .cat-name-input:focus { outline: none; border-bottom-color: var(--stroke-2); }
  .cat-del, .cat-lock { background: none; border: none; padding: 4px; flex-shrink: 0; display: flex; align-items: center; }
  .cat-del { color: var(--dim); }
  .cat-lock { color: var(--gold); }
  .del-confirm { padding: 12px 6px 6px; font-size: 12.5px; color: var(--lo); border-bottom: 1px solid var(--stroke); }
  .save-btn.danger { background: var(--red); color: #2a0709; }
</style>
