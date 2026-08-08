<script>
  // The actual bank-editing fields (name/balance/type/color/design/logo/
  // icon + live preview) -- shared by BankFormSheet.svelte's modal add/edit
  // sheet and OnboardingFlow's bank step, so there's one place for this
  // markup instead of two drifting copies. The caller owns the surrounding
  // chrome (sheet header, Save/Delete buttons, or the onboarding step's own
  // Next button) and just binds these fields.
  import { GOAL_COLORS, BANK_ICONS, BANK_LOGOS, CARD_DESIGNS, getCardDesign, cardBorderColor } from '../constants.js';
  import { fmt } from '../format.js';
  import BankIcon from './BankIcon.svelte';
  import CardPattern from './CardPattern.svelte';

  let {
    name = $bindable(''),
    balance = $bindable(''),
    type = $bindable('bank'),
    isMain = $bindable(false),
    color = $bindable(GOAL_COLORS[0]),
    icon = $bindable(null),
    logo = $bindable(null),
    design = $bindable('classic'),
    // Read-only -- these come from transactions, not this form. Onboarding
    // never has any yet (both stay 0); edit mode passes the bank's current
    // numbers through just so the preview shows something real.
    income = 0,
    spending = 0,
    // Fires on Enter in the Name field -- the caller decides what that
    // means (commit the sheet, or nothing, during a multi-step flow).
    onEnter = () => {},
  } = $props();

  let previewTag = $derived(isMain ? 'Main bank' : type === 'ewallet' ? 'E-wallet' : 'Bank');
  let previewDesign = $derived(getCardDesign(design));
  let previewBorderColor = $derived(cardBorderColor({ color, design }));
</script>

<div
  class="preview-card"
  style="border-color:{previewBorderColor}; box-shadow:5px 5px 0 {previewBorderColor}; background:{previewDesign.bg}; --card-fg:{previewDesign.fg}; --card-dim:{previewDesign.dim};"
>
  <CardPattern kind={previewDesign.pattern} color={previewDesign.patternColor} opacity={previewDesign.patternOpacity} />
  <div class="preview-top">
    <BankIcon {logo} {icon} {name} {color} />
    <div class="bank-id-text">
      <div class="bank-name">{name.trim() || 'New bank'}</div>
      <div class="bank-tag">{previewTag}</div>
    </div>
    <div class="bank-brand">BAJETBRO</div>
  </div>
  <div class="preview-detail">
    <div class="bank-balance-lbl">Balance</div>
    <div class="bank-balance-amt"><span class="cur">RM</span>{fmt(Number(balance) || 0)}</div>
    <div class="bank-stats-row">
      <div class="bank-stat">
        <div class="k">Income</div>
        <div class="v" style="color:var(--good);">RM {fmt(income)}</div>
      </div>
      <div class="bank-stat right">
        <div class="k">Spending</div>
        <div class="v" style="color:var(--red);">RM {fmt(spending)}</div>
      </div>
    </div>
  </div>
</div>

<div class="field-lbl">Name</div>
<input class="note-input" placeholder="e.g. Bank Islam" bind:value={name} onkeydown={(e) => e.key === 'Enter' && onEnter()} />

<div class="field-lbl">Balance</div>
<input class="note-input" type="number" inputmode="decimal" placeholder="0.00" bind:value={balance} />

<div class="field-lbl">Type</div>
<div class="chip-grid">
  <button class="chip" class:selected={type === 'bank'} onclick={() => (type = 'bank')}>Bank</button>
  <button class="chip" class:selected={type === 'ewallet'} onclick={() => (type = 'ewallet')}>E-wallet</button>
</div>

<div class="field-lbl">Main bank</div>
<button class="chip" class:selected={isMain} onclick={() => (isMain = !isMain)}>
  {isMain ? '✓ ' : ''}Receives salary / main bank
</button>

{#if design === 'classic'}
  <div class="field-lbl">Color</div>
  <div class="chip-grid">
    {#each GOAL_COLORS as c}
      <button class="color-swatch" style="background:{c};" class:selected={color === c} aria-label="Pick color" onclick={() => (color = c)}></button>
    {/each}
  </div>
{:else}
  <div class="field-lbl">Color</div>
  <p class="hint" style="margin:0 4px;">This design has its own matching border/shadow accent. Pick Classic to choose a custom color instead.</p>
{/if}

<div class="field-lbl">Card design</div>
<div class="chip-scroll">
  {#each CARD_DESIGNS as d}
    <button class="design-swatch" class:selected={design === d.key} onclick={() => (design = d.key)}>
      <span class="design-preview" style="background:{d.bg};">
        <CardPattern kind={d.pattern} color={d.patternColor} opacity={d.patternOpacity} />
      </span>
      <span class="design-label">{d.label}</span>
    </button>
  {/each}
</div>

<div class="field-lbl">Bank logo</div>
<div class="chip-scroll">
  {#each BANK_LOGOS as opt}
    <button class="chip" class:selected={logo === opt.slug} onclick={() => { logo = opt.slug; icon = null; }}>
      <BankIcon logo={opt.slug} size={20} />
      {opt.label}
    </button>
  {/each}
</div>
<p class="hint" style="margin:4px 4px 0;">Don't see yours yet? Pick a generic icon below instead.</p>

<div class="field-lbl">Generic icon</div>
<div class="chip-scroll">
  <button class="chip" class:selected={!icon && !logo} onclick={() => { icon = null; logo = null; }}>
    <BankIcon icon={null} {name} {color} size={20} />
    Initial
  </button>
  {#each BANK_ICONS as opt}
    <button class="chip" class:selected={icon === opt.key} onclick={() => { icon = opt.key; logo = null; }}>
      <BankIcon icon={opt.key} {name} {color} size={20} />
      {opt.label}
    </button>
  {/each}
</div>

<style>
  /* One swipeable line instead of .chip-grid's wrap-to-multiple-rows --
     there are more icon options than comfortably fit on one screen width.
     Setting overflow-x without an explicit overflow-y makes the Y axis
     compute to 'auto' too (not 'visible') -- so it silently became a clip
     box on that axis as well, cutting off the selected design-swatch's
     outline (which deliberately extends past its own border via
     outline-offset). Padding top/bottom gives that outline room to actually
     render inside the now-clipping box instead of past its edge. */
  .chip-scroll {
    display: flex; gap: 8px;
    overflow-x: auto;
    scrollbar-width: none;
    margin-bottom: 6px;
    padding: 4px 2px 6px;
  }
  .chip-scroll::-webkit-scrollbar { display: none; }
  .chip-scroll .chip { flex-shrink: 0; }

  .color-swatch {
    width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--stroke-2);
  }
  .color-swatch.selected { outline: 2.5px solid var(--stroke-2); outline-offset: 2px; }

  .design-swatch {
    display: flex; flex-direction: column; align-items: center; gap: 5px;
    background: none; border: none; flex-shrink: 0; width: 56px;
  }
  .design-preview {
    width: 52px; height: 34px; border-radius: 9px;
    border: 2px solid var(--stroke-2); position: relative; overflow: hidden;
    /* z-index:auto + position:relative does NOT create a local stacking
       context, so CardPattern's negative z-index would escape this box
       instead of staying scoped to it -- see .preview-card below for the
       same fix and full explanation. */
    z-index: 0;
  }
  .design-swatch.selected .design-preview { outline: 2.5px solid var(--stroke-2); outline-offset: 2px; }
  .design-label { font-size: 9.5px; font-weight: 600; color: var(--dim); text-align: center; }

  /* Live preview of the card as it'll actually render (ManageBanksSheet's
     .stack-card look) -- same markup/classes, just always at full size
     since there's no stacking/peeking to do here. background/--card-fg/
     --card-dim come from the chosen design (inline style); overflow:hidden
     clips CardPattern to the card's own rounded corners. */
  .preview-card {
    background: var(--panel);
    border: 2px solid var(--stroke-2);
    border-radius: 22px;
    position: relative;
    /* z-index:auto (the default) doesn't create a local stacking context
       even with position:relative set, so CardPattern's negative z-index
       escaped this box instead of staying scoped to it. */
    z-index: 0;
    overflow: hidden;
  }
  .preview-top {
    display: flex; align-items: center; gap: 12px;
    padding: 16px 18px;
  }
  .bank-id-text { flex: 1; min-width: 0; }
  .bank-name { font-weight: 700; font-size: 14.5px; color: var(--card-fg, var(--hi)); }
  .bank-tag { font-size: 10.5px; color: var(--card-dim, var(--dim)); font-weight: 600; margin-top: 1px; }
  .bank-brand {
    font-family: var(--display); font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em;
    color: var(--card-dim, var(--dim)); text-transform: uppercase; flex-shrink: 0;
  }
  .preview-detail { padding: 0 18px 18px; }
  .bank-balance-lbl { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--card-dim, var(--dim)); }
  .bank-balance-amt {
    font-family: var(--mono); font-variant-numeric: tabular-nums;
    font-size: 32px; font-weight: 700; letter-spacing: -0.01em;
    margin: 3px 0 14px;
    color: var(--card-fg, var(--hi));
  }
  .bank-balance-amt .cur { font-size: 15px; color: var(--card-dim, var(--dim)); font-weight: 600; margin-right: 3px; }
  .bank-stats-row { display: flex; justify-content: space-between; align-items: flex-start; }
  .bank-stat.right { text-align: right; }
  .bank-stat .k { font-size: 10.5px; color: var(--card-dim, var(--dim)); font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .bank-stat .v { font-size: 14px; font-weight: 700; margin-top: 3px; }
</style>
