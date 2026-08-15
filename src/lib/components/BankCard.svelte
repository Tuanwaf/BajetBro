<script>
  import { fmt } from '../format.js';
  import BankIcon from './BankIcon.svelte';
  import CardPattern from './CardPattern.svelte';
  import { getCardDesign, cardBorderColor, bankTypeLabel } from '../constants.js';
  import { valuesHidden } from '../bankPreviewStore.js';

  let { bank, balance, income, spending, reserved = 0, fixedDeposit = 0, isMain = false } = $props();

  let flipped = $state(false);
  let design = $derived(getCardDesign(bank.design));
  let borderColor = $derived(cardBorderColor(bank));
  let free = $derived(Math.max(0, balance - reserved - fixedDeposit));

  function toggleFlip() {
    flipped = !flipped;
  }
</script>

<!-- perspective lives on a plain wrapper (not .bank-card itself) so the
     card's own box-shadow/rotation isn't also warped by the 3D projection --
     only .flip-inner rotates; this element just gives it something to
     rotate WITHIN. -->
<div
  class="flip-card"
  role="button"
  tabindex="0"
  aria-label={flipped ? 'Show income and spending' : 'Show reserved and free-to-spend'}
  onclick={toggleFlip}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggleFlip())}
>
  <div class="flip-inner" class:flipped>
    <div
      class="bank-card face front"
      style="border-color:{borderColor}; box-shadow:5px 5px 0 {borderColor}; background:{design.bg}; --card-fg:{design.fg}; --card-dim:{design.dim};"
    >
      <CardPattern kind={design.pattern} color={design.patternColor} opacity={design.patternOpacity} />
      <div class="bank-card-top">
        <div class="bank-id">
          <BankIcon logo={bank.logo} icon={bank.icon} name={bank.name} color={bank.color} />
          <div>
            <div class="bank-name">{bank.name}</div>
            <div class="bank-tag">{isMain ? 'Main bank' : bankTypeLabel(bank.type)}</div>
          </div>
        </div>
        <div class="bank-brand">BAJETBRO</div>
      </div>

      <div class="bank-balance-row">
        <span class="bank-balance-lbl">Balance</span>
        <button class="eye-btn" aria-label={$valuesHidden ? 'Show balance' : 'Hide balance'} onclick={(e) => { e.stopPropagation(); valuesHidden.update((v) => !v); }}>
          {#if $valuesHidden}
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15"><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.5 6.7C4.3 8.2 2.7 10.3 2 12c1.6 3.6 5.6 7 10 7 1.8 0 3.5-.5 5-1.4M9.9 4.2A10.6 10.6 0 0 1 12 4c4.4 0 8.4 3.4 10 7-.5 1.1-1.2 2.2-2.1 3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none" width="15" height="15"><path d="M2 12c1.6-3.6 5.6-7 10-7s8.4 3.4 10 7c-1.6 3.6-5.6 7-10 7s-8.4-3.4-10-7Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg>
          {/if}
        </button>
      </div>
      <div class="bank-balance-amt"><span class="cur">RM</span>{$valuesHidden ? '••••••' : fmt(balance)}</div>

      <div class="bank-stats-row">
        <div class="bank-stat">
          <div class="k">Income</div>
          <div class="v num" style="color:var(--good);">RM {$valuesHidden ? '••••' : fmt(income)}</div>
        </div>
        <div class="bank-stat right">
          <div class="k">Spending</div>
          <div class="v num" style="color:var(--red);">RM {$valuesHidden ? '••••' : fmt(spending)}</div>
        </div>
      </div>

      <div class="flip-tag">
        <svg viewBox="0 0 24 24" fill="none" width="11" height="11"><path d="M3 12a9 9 0 0 1 15-6.7M21 12a9 9 0 0 1-15 6.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 3v3h-3M6 21v-3h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Flip
      </div>
    </div>

    <div
      class="bank-card face back"
      style="border-color:{borderColor}; box-shadow:5px 5px 0 {borderColor}; background:{design.bg}; --card-fg:{design.fg}; --card-dim:{design.dim};"
    >
      <CardPattern kind={design.pattern} color={design.patternColor} opacity={design.patternOpacity} />
      <div class="bank-card-top">
        <div class="bank-id">
          <BankIcon logo={bank.logo} icon={bank.icon} name={bank.name} color={bank.color} />
          <div>
            <div class="bank-name">{bank.name}</div>
            <div class="bank-tag">{isMain ? 'Main bank' : bankTypeLabel(bank.type)}</div>
          </div>
        </div>
        <div class="bank-brand">BAJETBRO</div>
      </div>

      <div class="bank-balance-row">
        <span class="bank-balance-lbl">Balance</span>
      </div>
      <div class="bank-balance-amt"><span class="cur">RM</span>{$valuesHidden ? '••••••' : fmt(balance)}</div>

      <div class="bank-stats-row">
        <div class="bank-stat">
          <div class="k">Reserved</div>
          <div class="v num" style="color:var(--gold);">RM {$valuesHidden ? '••••' : fmt(reserved)}</div>
        </div>
        {#if fixedDeposit > 0.005}
          <div class="bank-stat">
            <div class="k">Fixed deposit</div>
            <div class="v num" style="color:var(--gold);">RM {$valuesHidden ? '••••' : fmt(fixedDeposit)}</div>
          </div>
        {/if}
        <div class="bank-stat right">
          <div class="k">Free to spend</div>
          <div class="v num" style="color:var(--good);">RM {$valuesHidden ? '••••' : fmt(free)}</div>
        </div>
      </div>
      <div class="flip-tag">
        <svg viewBox="0 0 24 24" fill="none" width="11" height="11"><path d="M3 12a9 9 0 0 1 15-6.7M21 12a9 9 0 0 1-15 6.7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18 3v3h-3M6 21v-3h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Flip
      </div>
    </div>
  </div>
</div>

<style>
  .flip-card {
    perspective: 1400px;
    cursor: pointer;
  }
  .flip-inner {
    position: relative;
    width: 100%;
    transform-style: preserve-3d;
    transition: transform 0.5s cubic-bezier(0.4, 0.1, 0.2, 1);
  }
  .flip-inner.flipped { transform: rotateY(180deg); }

  .face {
    backface-visibility: hidden;
  }
  /* The front face stays in normal flow -- its natural height (which varies
     with content, e.g. a long bank name wrapping) becomes .flip-inner's own
     height for free. The back face is absolutely positioned to exactly
     overlay that same box instead of needing a guessed fixed height. */
  .face.back {
    position: absolute; inset: 0;
    transform: rotateY(180deg);
  }

  .bank-card {
    background: var(--panel);
    border: 2px solid var(--stroke-2);
    border-radius: 22px;
    padding: 32px 18px 16px;
    /* z-index:auto (the default) doesn't create a local stacking context
       even with position:relative set, so CardPattern's negative z-index
       escaped this box instead of staying scoped to it -- see .stack-card
       in ManageBanksSheet.svelte for the fuller explanation. Also needed so
       ::before (the traffic lights) and .flip-tag below can anchor to this
       box specifically, not the nearest OTHER positioned ancestor. */
    position: relative;
    z-index: 0;
    /* Clips CardPattern to the card's own rounded corners -- doesn't affect
       the card's own box-shadow, which paints outside the border box
       regardless of its overflow. */
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
  /* Traffic-light window dots, same treatment as the hero balance-card
     elsewhere in the app -- reuses the app's own semantic colors rather than
     literal macOS red/yellow/green. */
  .bank-card::before {
    content: "";
    position: absolute;
    top: 14px; left: 18px;
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--red);
    box-shadow: 16px 0 0 var(--gold), 32px 0 0 var(--good);
  }
  /* Sits in the same row as the traffic lights (top:14px) rather than
     taking a line of its own further down -- just a quiet affordance that
     this card flips, not something worth its own vertical space. */
  .flip-tag {
    position: absolute;
    top: 12px; right: 18px;
    display: flex; align-items: center; gap: 4px;
    font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
    color: var(--card-dim, var(--dim));
  }
  .bank-card-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
  .bank-id { display: flex; align-items: center; gap: 10px; }
  .bank-name { font-weight: 700; font-size: 14.5px; color: var(--card-fg, var(--hi)); }
  .bank-tag { font-size: 10.5px; color: var(--card-dim, var(--dim)); font-weight: 600; margin-top: 1px; }
  .bank-brand {
    font-family: var(--display); font-size: 10px; font-weight: 800; letter-spacing: 0.08em;
    color: var(--card-dim, var(--dim)); text-transform: uppercase;
  }

  .bank-balance-row { display: flex; align-items: center; gap: 6px; }
  .bank-balance-lbl { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: var(--card-dim, var(--dim)); }
  .eye-btn { background: none; border: none; padding: 2px; color: var(--card-dim, var(--dim)); display: flex; }
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
