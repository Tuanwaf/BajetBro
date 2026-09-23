<script>
  // Small flame icon, coloured per buddy tier (see TIERS[].fire in
  // streak.js -- the same palette as the celebration's 3D fire). Flickers
  // with plain CSS transforms, so it costs nothing to leave running;
  // `animate={false}` for places that show many at once (the calendar).
  // `unlit`: today isn't logged yet -- a hollow outline in the tier colour
  // that pulses gently, and pops alight the moment it turns lit.
  import { TIERS, GREY_FIRE } from '../streak.js';

  let { size = 16, tier = 0, grey = false, animate = true, unlit = false } = $props();

  let ignite = $state(false);
  let wasUnlit = unlit;
  $effect(() => {
    if (wasUnlit && !unlit) {
      ignite = true;
      const t = setTimeout(() => (ignite = false), 650);
      wasUnlit = unlit;
      return () => clearTimeout(t);
    }
    wasUnlit = unlit;
  });

  // Gradient ids must be unique per instance -- several flames share a page.
  const uid = `fl${Math.random().toString(36).slice(2, 9)}`;
  let t = $derived(TIERS[tier] ?? TIERS[0]);
  let fire = $derived(grey ? GREY_FIRE : t.fire);
  let rainbow = $derived(!grey && !unlit && !!t.rainbow);
  let glow = $derived(!grey && !unlit && !!t.glow);
</script>

<svg class="flame" class:animate class:rainbow class:glow class:unlit class:ignite style="--glow:{t.color}" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
  <defs>
    <linearGradient id="{uid}o" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color={fire[1]} />
      <stop offset="1" stop-color={fire[2]} />
    </linearGradient>
    <linearGradient id="{uid}i" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color={fire[0]} />
      <stop offset="1" stop-color={fire[1]} />
    </linearGradient>
  </defs>
  <path class="outer" d="M12 2.5c.6 3.2 3.3 4.9 4.9 7.4 1.4 2.2 1.8 4.9.6 7.3A6.4 6.4 0 0 1 12 21.5a6.4 6.4 0 0 1-5.8-3.6c-1.1-2.3-.8-4.9.6-6.9.5 1.4 1.4 2.3 2.5 2.7-.4-3.8 1-7.5 2.7-11.2Z" fill="url(#{uid}o)" stroke="var(--stroke-2)" stroke-width="1.4" stroke-linejoin="round"/>
  <path class="inner" d="M12.2 11.2c.4 1.6 2.3 2.6 2.3 4.8a2.6 2.6 0 0 1-5.1.6c-.3-1.3.3-2.4 1-3.1.1.7.5 1.1 1 1.3-.3-1.3.1-2.4.8-3.6Z" fill="url(#{uid}i)"/>
</svg>

<style>
  .flame { flex-shrink: 0; overflow: visible; }
  .flame path { transform-box: fill-box; transform-origin: 50% 100%; }
  .flame.animate .outer { animation: flick-outer 1.3s ease-in-out infinite alternate; }
  .flame.animate .inner { animation: flick-inner 0.9s ease-in-out infinite alternate; }
  .flame.rainbow { animation: hue 5s linear infinite; }
  /* Top tiers: a soft aura in the tier colour that breathes with the flicker. */
  .flame.glow { filter: drop-shadow(0 0 2px var(--glow)) drop-shadow(0 0 5px var(--glow)); }
  .flame.glow.animate { animation: aura 1.6s ease-in-out infinite alternate; }
  @keyframes aura {
    from { filter: drop-shadow(0 0 1.5px var(--glow)) drop-shadow(0 0 3px var(--glow)); }
    to { filter: drop-shadow(0 0 2.5px var(--glow)) drop-shadow(0 0 7px var(--glow)); }
  }
  @keyframes flick-outer {
    0% { transform: scale(1, 1) skewX(0deg); }
    35% { transform: scale(0.97, 1.05) skewX(-3deg); }
    70% { transform: scale(1.02, 0.97) skewX(2deg); }
    100% { transform: scale(0.98, 1.04) skewX(-1deg); }
  }
  @keyframes flick-inner {
    0% { transform: scale(1, 1) translateY(0); }
    50% { transform: scale(0.9, 1.12) translateY(-3%); }
    100% { transform: scale(1.05, 0.94) translateY(1%); }
  }
  @keyframes hue { to { filter: hue-rotate(360deg); } }

  /* Not logged yet today: hollow, dashed, breathing slowly. */
  .flame.unlit .outer { fill: none; stroke: var(--glow); stroke-width: 1.8; stroke-dasharray: 2.6 2; }
  .flame.unlit .inner { display: none; }
  .flame.unlit.animate .outer { animation: none; }
  .flame.unlit.animate { animation: unlit-pulse 2.4s ease-in-out infinite; }
  @keyframes unlit-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 0.9; } }
  .flame.ignite.animate { animation: ignite 0.65s cubic-bezier(0.3, 1.6, 0.5, 1); }
  @keyframes ignite {
    0% { transform: scale(0.6); opacity: 0.5; }
    60% { transform: scale(1.3); opacity: 1; }
    100% { transform: scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .flame .outer, .flame .inner, .flame.rainbow, .flame.glow, .flame.unlit, .flame.ignite { animation: none !important; }
  }
</style>
