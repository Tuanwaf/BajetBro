<script>
  // Decorative line-art behind a bank card's content -- one fixed, hand-
  // placed motif per CARD_DESIGNS `kind` (constants.js), not a random one.
  // Percentage coordinates throughout so shapes scale with whatever size
  // the card actually renders at (Home's carousel vs. Settings' peek cards
  // vs. the form preview are all different widths) -- SVG only supports
  // percentages on <circle>/<line> geometry, not on <path> "d" data, which
  // is why every motif here is built from just those two primitives.
  let { kind = 'arcs', color = '#ffffff', opacity = 0.14 } = $props();

  // Evenly-spaced rays fanning from a corner -- computed with real trig
  // instead of hand-picked endpoints, which is what made the earlier
  // version of these bunch up unevenly. originX/Y and the endpoints are
  // all percentages of the card's own box, degrees measured the normal SVG
  // way (0 = right, 90 = down).
  function fanLines(originX, originY, startDeg, endDeg, count, length) {
    return Array.from({ length: count }, (_, i) => {
      const deg = count === 1 ? startDeg : startDeg + ((endDeg - startDeg) * i) / (count - 1);
      const rad = (deg * Math.PI) / 180;
      return {
        x2: originX + Math.cos(rad) * length,
        y2: originY + Math.sin(rad) * length,
      };
    });
  }

  const sunsetRays = fanLines(100, 100, 190, 260, 5, 70);
  const amberRays = fanLines(0, 0, 8, 82, 6, 95);
</script>

<svg class="card-pattern" aria-hidden="true">
  {#if kind === 'stars'}
    <!-- Midnight: a scatter of small stars plus a moon ring in the corner. -->
    <circle cx="92%" cy="-6%" r="26%" fill="none" stroke={color} stroke-width="1.2" opacity={opacity * 1.6} />
    <circle cx="18%" cy="18%" r="2" fill={color} opacity={opacity * 1.4} />
    <circle cx="42%" cy="9%" r="1.6" fill={color} opacity={opacity * 1.2} />
    <circle cx="70%" cy="24%" r="2.2" fill={color} opacity={opacity * 1.4} />
    <circle cx="85%" cy="55%" r="1.8" fill={color} opacity={opacity * 1.2} />
    <circle cx="30%" cy="72%" r="1.6" fill={color} opacity={opacity * 1.2} />
    <circle cx="60%" cy="85%" r="2" fill={color} opacity={opacity * 1.4} />
  {:else if kind === 'swell'}
    <!-- Ocean: rolling arcs peeking up from the bottom edge, like swells. -->
    <circle cx="10%" cy="102%" r="34%" fill="none" stroke={color} stroke-width="1.3" opacity={opacity * 1.8} />
    <circle cx="48%" cy="110%" r="42%" fill="none" stroke={color} stroke-width="1.3" opacity={opacity * 1.6} />
    <circle cx="88%" cy="102%" r="30%" fill="none" stroke={color} stroke-width="1.3" opacity={opacity * 1.8} />
  {:else if kind === 'sun'}
    <!-- Sunset: rays fanning up-and-left from the bottom-right corner.
       (Used to also draw a "sun" circle behind them, but SVG resolves a
       circle's r% against the box's DIAGONAL while cx/cy% resolve against
       width/height -- different bases, so the circle's edge never actually
       lined up with where the rays started, leaving a visible gap or
       overlap depending on the card's aspect ratio. Dropping the circle
       sidesteps that entirely.) -->
    {#each sunsetRays as ray}
      <line x1="100%" y1="100%" x2="{ray.x2}%" y2="{ray.y2}%" stroke={color} stroke-width="1.2" opacity={opacity * 1.8} />
    {/each}
  {:else if kind === 'canopy'}
    <!-- Forest: a cluster of overlapping leaf-like circles in one corner. -->
    <circle cx="88%" cy="8%" r="16%" fill={color} opacity={opacity * 1.3} />
    <circle cx="100%" cy="22%" r="12%" fill={color} opacity={opacity * 1.1} />
    <circle cx="76%" cy="24%" r="10%" fill={color} opacity={opacity * 1.1} />
    <circle cx="92%" cy="38%" r="8%" fill={color} opacity={opacity} />
  {:else if kind === 'grid'}
    <!-- Graphite: an even dot grid crossed by two diagonals, circuit-ish. -->
    {#each [15, 40, 65, 90] as x}
      {#each [22, 55, 85] as y}
        <circle cx="{x}%" cy="{y}%" r="1.6" fill={color} opacity={opacity} />
      {/each}
    {/each}
    <line x1="0%" y1="0%" x2="100%" y2="60%" stroke={color} stroke-width="1" opacity={opacity * 1.4} />
    <line x1="100%" y1="0%" x2="30%" y2="100%" stroke={color} stroke-width="1" opacity={opacity * 1.4} />
  {:else if kind === 'rings'}
    <!-- Maroon: three concentric rings low in the opposite corner from
       Classic's arcs, for a richer/heavier feel. -->
    <circle cx="-6%" cy="108%" r="55%" fill="none" stroke={color} stroke-width="1.3" opacity={opacity * 1.8} />
    <circle cx="-6%" cy="108%" r="40%" fill="none" stroke={color} stroke-width="1.2" opacity={opacity * 2} />
    <circle cx="-6%" cy="108%" r="25%" fill="none" stroke={color} stroke-width="1.1" opacity={opacity * 2.2} />
  {:else if kind === 'rays'}
    <!-- Amber: a full sunburst fanning from the top-left corner, evenly
       spaced (the old hand-picked angles bunched up instead of fanning). -->
    {#each amberRays as ray}
      <line x1="0%" y1="0%" x2="{ray.x2}%" y2="{ray.y2}%" stroke={color} stroke-width="1.1" opacity={opacity * 1.6} />
    {/each}
  {:else}
    <!-- Classic (default): two plain concentric arcs, top-right. -->
    <circle cx="104%" cy="-12%" r="78%" fill="none" stroke={color} stroke-width="1.4" opacity={opacity * 2} />
    <circle cx="104%" cy="-12%" r="58%" fill="none" stroke={color} stroke-width="1.2" opacity={opacity * 2.4} />
  {/if}
</svg>

<style>
  .card-pattern {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    /* Negative z-index paints behind normal in-flow content but in front
       of the card's own background -- see CSS spec painting order; a
       positioned descendant with z-index:auto would otherwise paint ON TOP
       of in-flow siblings regardless of DOM order. Only works if the
       PARENT card actually establishes its own stacking context (position
       + a non-auto z-index) -- otherwise this escapes to whatever ancestor
       context is next up the tree instead of staying scoped to this card,
       which is exactly what was hiding it on the focused/Home/preview
       cards (see z-index:0 on their card rules). */
    z-index: -1;
    pointer-events: none;
  }
</style>
