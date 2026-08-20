<script>
  // Adapted from https://uiverse.io/byllzz/rude-bat-50 -- a pure-CSS wallet
  // of stacked cards that fan out and reveal their numbers on :hover. This
  // app is a PWA with no real hover on a touchscreen, so every hover trigger
  // there becomes a tap here instead: tap the pocket to fan the whole stack
  // out and reveal the total, tap an individual card to bring it to the
  // front.
  //
  // Card markup/style below is a direct copy of ManageBanksSheet.svelte's
  // OWN .stack-card design (now disabled there behind {#if false} while this
  // is the focus) -- NOT Home's BankCard.svelte, which is a different look
  // (traffic-light dots, a flip-to-back gesture) that doesn't belong to this
  // page. No flip here: a real ~205px-tall static face only.
  import { round2 } from '../calc.js';
  import { fmt } from '../format.js';
  import { getCardDesign, cardBorderColor, bankTypeLabel } from '../constants.js';
  import BankIcon from './BankIcon.svelte';
  import CardPattern from './CardPattern.svelte';

  // onEditBank(bank): called when an already-focused card is tapped again --
  // same "tap to focus, tap again to edit" gesture the old stack UI had
  // (ManageBanksSheet's own onCardTap/openEditForm, now disabled). Left as a
  // no-op default so this component doesn't hard-require a caller to wire it.
  //
  // collapse: true while some OTHER sheet the caller considers mutually
  // exclusive with this one is open (ManageBanksSheet passes its own
  // organizeOpen). A focused card's z-index (999, see the markup below) was
  // never actually contained to this component -- neither .sheet-page nor
  // .wallet-outer establish their own stacking context, so it competed
  // directly with sibling overlays' own z-index elsewhere on the page (the
  // Organize sheet's 71), and won. Only activeId needs clearing to fix
  // that -- it's the 999 that escapes and wins the comparison, not the fan
  // itself, so this only un-focuses whichever card was active, staying in
  // list state exactly as it was rather than also collapsing the wallet
  // back to resting (fanned is left alone on purpose).
  let { banks = [], onEditBank = () => {}, collapse = false } = $props();

  let fanned = $state(false);
  let activeId = $state(null);

  $effect(() => {
    if (collapse) activeId = null;
  });

  let total = $derived(round2(banks.reduce((s, b) => s + (b.balance || 0), 0)));

  function bankTag(entry) {
    return entry.bank.isMain ? 'Main bank' : bankTypeLabel(entry.bank.type);
  }

  // Tapping the pocket/background (never a card -- see cardCapture below,
  // which stops the event before it ever reaches here) opens the fan on
  // first tap, closes it on the next.
  function tapWallet() {
    fanned = !fanned;
    if (!fanned) activeId = null;
  }

  // Capture-phase so a card tap is intercepted before it could bubble up to
  // tapWallet and collapse the fan out from under it. First tap on a card
  // brings it to the front (and opens the fan if it wasn't already); a
  // second tap on that SAME already-focused card requests edit instead of
  // just re-selecting itself (a no-op otherwise).
  function cardCapture(bank, e) {
    e.stopPropagation();
    if (activeId === bank.id) {
      onEditBank(bank);
      return;
    }
    if (!fanned) fanned = true;
    activeId = bank.id;
  }

  // Fan-out geometry, index-based so this works for any number of banks (the
  // original demo hardcoded three fixed offsets/rotations, one per named
  // card). Index 0 sits furthest BACK (peeks highest, lowest z-index) and
  // the last index sits frontmost (least raised, highest z-index) -- same
  // relationship the original's stripe/wise/paypal had, generalized to N.
  // These real cards are ~205px tall (see ManageBanksSheet's own comment on
  // .stack-card) -- much taller than the demo's 140px ones, so the pouch
  // geometry below is scaled up proportionally from the original (which
  // sized its 160px pocket/200px back panel around a 140px card) rather
  // than reused as-is; keeping the demo's small pocket under a card nearly
  // 1.5x taller is what left cards floating above it with no visible pouch
  // to speak of.
  const CARD_HEIGHT_EST = 210;
  const POCKET_HEIGHT = 180;
  // Both reduced together: the front-most card's peek above the pocket is
  // (REST_BASE + card height) - POCKET_HEIGHT, so shrinking POCKET_HEIGHT
  // (220 -> 180) without also lowering REST_BASE left MORE of the front
  // card exposed than intended -- not just its header, but its "Balance"
  // label underneath too. REST_STEP is separately smaller because the
  // whole peeking stack behind the front card was rising well above the
  // wallet itself once the wallet was made more compact -- tall relative to
  // a small pouch reads as mismatched/disproportionate even though each
  // individual gap looked fine on its own.
  const REST_STEP = 14;
  const REST_BASE = 10;
  // Tighter than one card's own header-row height (~64px, see
  // .stack-card-top's padding below) -- enough to tell each card's icon/
  // name apart when fanned without the whole list ballooning in height once
  // there are several banks (each extra bank adds a full FAN_STEP to the
  // page's total height).
  const FAN_STEP = 48;
  // The FRONT-most fanned card's bottom edge must clear the pocket's own
  // height, not just rise a little from its resting spot -- every card is
  // built from this same base (see bottomFor), so once the front one clears
  // the pocket, everything behind it (which sits even higher) automatically
  // does too. This is also what keeps the pocket's own embedded balance text
  // reachable: with no card ever overlapping the pocket while fanned, there's
  // nothing left to fight it for clicks or paint over it.
  const FAN_BASE = POCKET_HEIGHT + 8;
  function bottomFor(i, n, isFanned) {
    const depthFromFront = n - 1 - i;
    return isFanned ? FAN_BASE + depthFromFront * FAN_STEP : REST_BASE + depthFromFront * REST_STEP;
  }
  // A fixed, uniform tilt, alternating by index -- NOT scaled by distance
  // from the stack's centre (i - (n-1)/2) * step, which is what this used
  // to be. That formula meant the actual angle depended on both position
  // AND how many banks there were: the middle card sat at ~0deg while ones
  // near either end could reach +-9deg or more with a handful of banks --
  // "looks tilted" was never a consistent amount card to card. Alternating
  // a single fixed angle keeps every card's tilt visually identical
  // regardless of where it sits or how many banks are in the stack.
  const TILT_DEG = 3;
  function rotateFor(i) {
    return i % 2 === 0 ? -TILT_DEG : TILT_DEG;
  }
  // Grows with both bank count and fan state -- a fixed height either left
  // a large dead gap below the resting stack, or wasn't tall enough once
  // fanned and clipped nothing visually (position:absolute ignores it) but
  // made the page's own scroll/layout wrong around it.
  let stackHeight = $derived(CARD_HEIGHT_EST + bottomFor(0, banks.length, fanned) + 10);
</script>

<!-- .wallet-slot has a fixed height (at rest) that .wallet-outer centres
     within, rather than .wallet-outer itself just growing downward from a
     fixed top margin -- that was the actual bug: more banks stack higher at
     rest (see bottomFor), so .wallet-outer's own height grows too, and a
     box anchored by a fixed top margin only gets TALLER from a fixed start
     point, pushing its bottom (where the visible wallet actually sits)
     further down the page every time a bank was added. Centering inside a
     stable-height slot instead means the wallet stays centered regardless
     of how tall the stack of cards behind it grows. -->
<div class="wallet-slot" class:fanned>
<div class="wallet-outer" class:fanned style="height:{stackHeight}px;">
  <div class="wallet-back"></div>

  <div
    class="wallet"
    class:fanned
    role="button"
    tabindex="0"
    aria-label={fanned ? 'Collapse wallet' : 'Tap to fan out your banks'}
    onclick={tapWallet}
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), tapWallet())}
  >
    {#each banks as b, i (b.bank.id)}
      {@const design = getCardDesign(b.bank.design)}
      {@const borderColor = cardBorderColor(b.bank)}
      <div
        class="stack-card"
        class:active={activeId === b.bank.id}
        style="bottom:{bottomFor(i, banks.length, fanned)}px; --rot:{fanned ? rotateFor(i) : 0}deg; z-index:{activeId === b.bank.id ? 999 : 10 + i};
          border-color:{borderColor}; box-shadow:5px 5px 0 {borderColor}; background:{design.bg}; --card-fg:{design.fg}; --card-dim:{design.dim};"
        role="presentation"
        onclickcapture={(e) => cardCapture(b.bank, e)}
      >
        <CardPattern kind={design.pattern} color={design.patternColor} opacity={design.patternOpacity} />
        <div class="stack-card-top">
          <BankIcon logo={b.bank.logo} icon={b.bank.icon} name={b.bank.name} color={b.bank.color} />
          <div class="bank-id-text">
            <div class="bank-name">{b.bank.name}</div>
            <div class="bank-tag">{bankTag(b)}</div>
          </div>
          <div class="bank-brand">BAJETBRO</div>
        </div>
        <div class="stack-detail">
          <div class="bank-balance-lbl">Balance</div>
          <div class="bank-balance-amt"><span class="cur">RM</span>{fmt(b.balance)}</div>
          <div class="bank-stats-row">
            <div class="bank-stat">
              <div class="k">Income</div>
              <div class="v" style="color:var(--good);">RM {fmt(b.income)}</div>
            </div>
            <div class="bank-stat right">
              <div class="k">Spending</div>
              <div class="v" style="color:var(--red);">RM {fmt(b.spending)}</div>
            </div>
          </div>
        </div>
      </div>
    {/each}

    <div class="pocket">
      <svg class="pocket-svg" viewBox="0 0 280 160" fill="none" preserveAspectRatio="none">
        <path
          d="M 0 20 C 0 10, 5 10, 10 10 C 20 10, 25 25, 40 25 L 240 25 C 255 25, 260 10, 270 10 C 275 10, 280 10, 280 20 L 280 120 C 280 155, 260 160, 240 160 L 40 160 C 20 160, 0 155, 0 120 Z"
          fill="var(--stroke-2)"
        ></path>
        <path
          d="M 8 22 C 8 16, 12 16, 15 16 C 23 16, 27 29, 40 29 L 240 29 C 253 29, 257 16, 265 16 C 268 16, 272 16, 272 22 L 272 120 C 272 150, 255 152, 240 152 L 40 152 C 25 152, 8 152, 8 120 Z"
          stroke="var(--gold)"
          stroke-width="1.5"
          stroke-dasharray="6 4"
        ></path>
      </svg>
      <!-- pointer-events:auto overrides .pocket's own none, just for this
           text -- FAN_BASE (above) guarantees no card ever overlaps the
           pocket while fanned, so this never has to compete with an active
           card's z-index for clicks or visibility; at rest, cards sit
           BELOW the pocket's own z-index (50) by design, so this is simply
           the topmost thing there either way. -->
      <div
        class="pocket-content"
        role="button"
        tabindex="0"
        aria-label={fanned ? 'Collapse wallet' : 'Reveal total balance'}
        onclick={(e) => (e.stopPropagation(), tapWallet())}
        onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), e.stopPropagation(), tapWallet())}
      >
        <span class="pocket-balance">{fanned ? `RM ${fmt(total)}` : 'RM ••••••'}</span>
        <!-- Its own element between the balance and the brand line (not
             tucked right under the balance) so justify-content:space-between
             on .pocket-content (3 children now) spaces all three evenly,
             landing the eye centered in between rather than clustered with
             the balance. Same eye/eye-slash pair BankCard.svelte's own
             reveal toggle uses, for the same reveal-vs-hidden meaning. -->
        {#if fanned}
          <svg class="pocket-eye" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12c1.6-3.6 5.6-7 10-7s8.4 3.4 10 7c-1.6 3.6-5.6 7-10 7s-8.4-3.4-10-7Z" stroke="var(--gold)" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="var(--gold)" stroke-width="1.6"/></svg>
        {:else}
          <svg class="pocket-eye" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.24 4.24M6.5 6.7C4.3 8.2 2.7 10.3 2 12c1.6 3.6 5.6 7 10 7 1.8 0 3.5-.5 5-1.4M9.9 4.2A10.6 10.6 0 0 1 12 4c4.4 0 8.4 3.4 10 7-.5 1.1-1.2 2.2-2.1 3.2" stroke="var(--gold)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {/if}
        <div class="pocket-brand">BAJETBRO</div>
      </div>
    </div>
  </div>
</div>
</div>

<style>
  /* Fixed height (at rest) that .wallet-outer centres within -- see the
     markup comment above for why this replaced a fixed top margin on
     .wallet-outer itself. Uses --app-vh (main.js), not a plain vh unit,
     since iOS Safari's dynamic address bar makes real vh units unreliable
     (see main.js's own comment on it). Collapses to auto-height once
     fanned, left-aligned to the top instead of centered -- the now-tall
     expanded list should just flow in the page normally, not be centered
     inside a slot sized for the much shorter resting state. */
  .wallet-slot {
    display: flex;
    flex-direction: column;
    justify-content: center;
    height: calc(var(--app-vh, 1dvh) * 55);
    transition: height 0.5s ease;
  }
  .wallet-slot.fanned {
    height: auto;
    justify-content: flex-start;
  }
  .wallet-outer {
    position: relative;
    width: 100%;
    max-width: 320px;
    margin: 0 auto 30px;
    /* Height comes from the inline style (JS-computed, see stackHeight) --
       overflow stays visible (never set otherwise below) so fanned-out
       cards are free to rise above the pouch exactly like the original
       demo's cards rise past its own .wallet box; nothing needs to clip. */
    transition: height 0.5s cubic-bezier(0.34, 1.2, 0.64, 1);
  }
  /* The "back" of the wallet -- a panel behind the pocket/cards, same idea
     as the original's .wallet-back: it's what makes the pocket read as an
     actual pouch with depth instead of a flat cutout floating on the page.
     Themed to this app's own ink/stroke tokens rather than the original's
     hardcoded dark green. Taller than .pocket below (same relationship the
     original kept, its panel taller than its own pocket) -- SIZED FOR A
     ~205PX CARD, not the original's 140px one, which is what made this and
     the pocket read as a tiny accent behind a mostly-floating card before. */
  .wallet-back {
    position: absolute;
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
    width: 92%;
    height: 210px;
    background: var(--stroke-2);
    border-radius: 22px 22px 60px 60px;
    z-index: 1;
    box-shadow: inset 0 25px 35px rgba(0, 0, 0, 0.35), inset 0 5px 15px rgba(0, 0, 0, 0.45);
  }

  .wallet {
    position: absolute;
    inset: 0;
    cursor: pointer;
  }

  /* Copied from ManageBanksSheet.svelte's own .stack-card/.stack-card-face/
     .stack-card-top/.stack-detail/.bank-* rules -- same look, deliberately,
     see the script comment at top. No traffic-light dots, no flip tag, no
     flip transform: this design never had either. */
  .stack-card {
    position: absolute;
    left: 50%;
    width: 88%;
    max-width: 270px;
    background: var(--panel);
    border: 2px solid var(--stroke-2);
    border-radius: 22px;
    overflow: hidden;
    transform: translateX(-50%) rotate(var(--rot));
    transition: bottom 0.5s cubic-bezier(0.34, 1.2, 0.64, 1), transform 0.5s cubic-bezier(0.34, 1.2, 0.64, 1);
  }
  .stack-card.active {
    transform: translateX(-50%) rotate(0deg) scale(1.04);
  }
  .stack-card-top {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 18px;
  }
  .bank-id-text { flex: 1; min-width: 0; }
  .bank-name { font-weight: 700; font-size: 14.5px; color: var(--card-fg, var(--hi)); }
  .bank-tag { font-size: 10.5px; color: var(--card-dim, var(--dim)); font-weight: 600; margin-top: 1px; }
  .bank-brand {
    font-family: var(--display); font-size: 9.5px; font-weight: 800; letter-spacing: 0.08em;
    color: var(--card-dim, var(--dim)); text-transform: uppercase; flex-shrink: 0;
  }
  .stack-detail { padding: 0 18px 18px; }
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

  /* pointer-events:none so a resting card's peeking sliver underneath (see
     .stack-card, lower z-index than this at rest) always stays reachable
     through it -- .pocket-content below opts back in with its own
     pointer-events:auto. */
  .pocket { position: absolute; bottom: 0; left: 50%; transform: translateX(-50%); width: 100%; max-width: 300px; height: 180px; z-index: 50; pointer-events: none; }
  .pocket-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
  /* inset:0 (not just a top-anchored text block) -- the tap target for
     open/close used to be only as big as the text itself, a small strip
     near the top of the pouch. Filling the whole pocket area makes the
     entire visible pouch tappable. justify-content:space-between across the
     three direct children (balance, eye, brand) spaces them evenly top to
     bottom, landing the eye centered in the middle rather than clustered
     against either the balance or the brand line. */
  .pocket-content {
    position: absolute;
    inset: 0;
    padding: 44px 0 16px;
    text-align: center;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    align-items: center;
    pointer-events: auto;
    cursor: pointer;
  }
  .pocket-balance { font-family: var(--mono); font-variant-numeric: tabular-nums; font-size: 21px; font-weight: 700; color: var(--ink); }
  .pocket-eye { width: 26px; height: 26px; }
  .pocket-brand {
    font-family: var(--display); font-size: 10px; font-weight: 800; letter-spacing: 0.08em;
    color: var(--gold); text-transform: uppercase; opacity: 0.8;
  }
</style>
