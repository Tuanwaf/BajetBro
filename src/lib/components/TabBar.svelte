<script>
  import { onMount, onDestroy } from 'svelte';
  import { currentView } from '../viewStore.js';

  let { onAddClick, hidden = false } = $props();

  const NAV = [
    { id: 'home', label: 'Home' },
    { id: 'goals', label: 'Goals' },
    { id: 'history', label: 'History' },
    { id: 'settings', label: 'Settings' },
  ];
  const half = Math.ceil(NAV.length / 2);
  const leftTabs = NAV.slice(0, half);
  const rightTabs = NAV.slice(half);

  let pillEl;
  let indicatorEl;
  let tabEls = [];

  const NAV_INSET = 7; // horizontal gap between the highlight pill and the tab edges

  // Mass-spring physics ported from a real iOS-style "liquid" dock (studied
  // live: cheerful-muffin-cbb076.netlify.app's Drag Dock demo) rather than
  // guessed. Position, squash/stretch scale, and a "pickup" pop are each
  // their own Spring (F = -k*x - c*v, semi-implicit Euler) so the highlight
  // follows the finger 1:1 while dragging, stretches under velocity, and
  // settles with a gentle overshoot on release -- none of that comes from a
  // flat CSS transition.
  class Spring {
    constructor(v, s = 300, d = 20) {
      this.value = v; this.target = v; this.velocity = 0; this.stiffness = s; this.damping = d;
    }
    setTarget(t) { this.target = t; }
    update(dt) {
      const f = (this.target - this.value) * this.stiffness;
      const df = this.velocity * this.damping;
      this.velocity += (f - df) * dt;
      this.value += this.velocity * dt;
      return this.value;
    }
    isSettled() { return Math.abs(this.target - this.value) < 0.01 && Math.abs(this.velocity) < 0.5; }
  }
  // Position spring intentionally much softer than the squash/stretch/pop
  // springs below: a tap between the two far tabs (Home <-> Settings) should
  // read as a visible glide across the dock, not an instant snap. Same
  // damping ratio as before (~0.61, so it still settles with a touch of
  // overshoot) just at lower stiffness, which is what actually slows the
  // travel time -- damping alone (without also dropping stiffness) only
  // changes how much it wobbles, not how long the trip takes.
  const spX = new Spring(0, 150, 15), spSX = new Spring(1, 500, 24), spSY = new Spring(1, 500, 24), spPop = new Spring(1, 400, 20);
  let navRAF = null, navLast = 0, navInitialized = false, baseW = 0;

  // Tab's true visual centre in the pill's own layout px -- measured from
  // rects so it's immune to offsetParent/border quirks.
  function tabCenterX(t) {
    const pr = pillEl.getBoundingClientRect(), tr = t.getBoundingClientRect();
    return tr.left + tr.width / 2 - pr.left - pillEl.clientLeft;
  }
  function clientXToLayoutX(clientX) {
    const rect = pillEl.getBoundingClientRect();
    return clientX - rect.left - pillEl.clientLeft;
  }
  // The highlight's width/height never change -- only translateX/scale do,
  // which is what lets it stretch from its own centre for free. Recomputed
  // on every settle call (cheap) so call-order against onMount never matters.
  function computeBaseSize() {
    const t = tabEls[0]; if (!t) return;
    baseW = Math.max(0, t.offsetWidth - 2 * NAV_INSET);
    if (indicatorEl) indicatorEl.style.width = baseW + 'px';
  }
  function setIndicatorTransform(x, sx, sy) {
    if (indicatorEl) indicatorEl.style.transform = `translateX(${x}px) scale(${sx}, ${sy})`;
  }
  function navLoop(now) {
    const dt = Math.min(now - (navLast || now), 32) / 1000;
    navLast = now;
    const vx = Math.abs(spX.velocity), st = Math.min(1, vx / 900);
    spSX.setTarget(1 + st * 0.55);
    spSY.setTarget(Math.max(0.72, 1 - st * 0.28));
    const cx = spX.update(dt), sx = spSX.update(dt), sy = spSY.update(dt), pop = spPop.update(dt);
    setIndicatorTransform(cx, sx * pop, sy * pop);
    if (spX.isSettled() && spSX.isSettled() && spSY.isSettled() && spPop.isSettled()) navRAF = null;
    else navRAF = requestAnimationFrame(navLoop);
  }
  function kickNavLoop() {
    if (!navRAF) { navLast = 0; navRAF = requestAnimationFrame(navLoop); }
  }
  function highlightTab(i) {
    tabEls.forEach((t, k) => t && t.classList.toggle('active', k === i));
  }
  function nearestTabIndexAt(centerX) {
    let best = 0, bd = Infinity;
    tabEls.forEach((t, k) => {
      if (!t) return;
      const d = Math.abs(centerX - tabCenterX(t));
      if (d < bd) { bd = d; best = k; }
    });
    return best;
  }
  // Exponential rubber-band: lets the pill's left edge push up to ~15px past
  // the first/last tab with increasing resistance, instead of a hard stop.
  function clampRubberBand(leftX) {
    const first = tabEls[0], last = tabEls[tabEls.length - 1];
    if (!first || !last) return leftX;
    const mn = tabCenterX(first) - baseW / 2, mx = tabCenterX(last) - baseW / 2, mo = 15;
    if (leftX < mn) return mn - mo * (1 - Math.exp((leftX - mn) / 50));
    if (leftX > mx) return mx + mo * (1 - Math.exp(-(leftX - mx) / 50));
    return leftX;
  }
  // Single settle point -- called whenever the view changes, from ANY
  // source: our own drag/tap, or another screen jumping here directly (e.g.
  // Home's "Feeds your Goals pool ->" link, which sets currentView itself).
  function settleToView(v) {
    if (!pillEl) return;
    computeBaseSize();
    const i = Math.max(0, NAV.findIndex((n) => n.id === v));
    highlightTab(i);
    const t = tabEls[i]; if (!t) return;
    const targetX = tabCenterX(t) - baseW / 2;
    if (!navInitialized) {
      spX.value = spX.target = targetX; spX.velocity = 0;
      spSX.value = spSX.target = 1; spSY.value = spSY.target = 1; spPop.value = spPop.target = 1;
      setIndicatorTransform(targetX, 1, 1);
      navInitialized = true;
      return;
    }
    spX.setTarget(targetX);
    kickNavLoop();
  }

  let dragActive = false, dragMoved = false, dragStartX = 0, grabOffset = 0, dragWatchdog = null;

  // Belt-and-suspenders against the highlight ever getting stranded between
  // two tabs. A single pointercancel fix wasn't enough in practice, which
  // means something is dropping the termination event entirely on real
  // devices, not just swapping pointerup for pointercancel. Three
  // independent nets, any one of which resolves it:
  //  1. move/up/cancel are attached to `window`, not the pill, for the
  //     duration of the drag -- if the finger drifts slightly outside the
  //     pill's own (fairly thin) hit area, or setPointerCapture silently
  //     fails/behaves inconsistently in installed-PWA mode, window-level
  //     listeners still receive the events regardless of what's directly
  //     under the finger. This is the standard, capture-independent pattern
  //     for drag interactions.
  //  2. `lostpointercapture` is the Pointer Events spec's own guaranteed
  //     signal that a capture-based interaction has ended, for cases that
  //     don't cleanly map to either pointerup or pointercancel.
  //  3. A watchdog timer re-armed on every pointermove: if 400ms pass with
  //     the pointer down but no event of any kind arrives, force a settle
  //     anyway. This is the absolute last resort if every event-based path
  //     fails simultaneously.
  function armWatchdog() {
    clearTimeout(dragWatchdog);
    dragWatchdog = setTimeout(() => { if (dragActive) settleDragEnd(); }, 400);
  }
  function disarmWatchdog() {
    clearTimeout(dragWatchdog);
    dragWatchdog = null;
  }
  function attachDragListeners() {
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
  }
  function detachDragListeners() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerCancel);
  }
  function onPointerDown(e) {
    if (e.target.closest('.navfab')) return;
    dragActive = true; dragMoved = false; dragStartX = e.clientX;
    const prx = clientXToLayoutX(e.clientX), cx = spX.value;
    // Preserve the finger's grab offset within the pill instead of
    // re-centring under the cursor -- same "picked up a specific point"
    // realism as the reference dock.
    grabOffset = (prx >= cx && prx <= cx + baseW) ? (prx - cx) : baseW / 2;
    const tx = clampRubberBand(prx - grabOffset);
    spX.setTarget(tx);
    highlightTab(nearestTabIndexAt(tx + baseW / 2));
    spPop.setTarget(1.08);
    kickNavLoop();
    armWatchdog();
    attachDragListeners();
    try { pillEl.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onPointerMove(e) {
    if (!dragActive) return;
    if (!dragMoved && Math.abs(e.clientX - dragStartX) > 4) dragMoved = true;
    if (!dragMoved) return;
    armWatchdog();
    const prx = clientXToLayoutX(e.clientX);
    const tx = clampRubberBand(prx - grabOffset);
    spX.setTarget(tx);
    highlightTab(nearestTabIndexAt(tx + baseW / 2));
    kickNavLoop();
  }
  // Both "the finger lifted" and "the gesture got cancelled" (iOS Safari can
  // send pointercancel instead of pointerup for a handful of edge cases --
  // an interrupting system gesture, a scroll re-interpretation, etc.) must
  // always resolve onto one of the 4 tabs.
  function settleDragEnd() {
    dragActive = false;
    disarmWatchdog();
    detachDragListeners();
    spPop.setTarget(1);
    const i = nearestTabIndexAt(spX.target + baseW / 2);
    currentView.set(NAV[i].id);
    // Explicit, not just reactive: Svelte's writable store skips notifying
    // subscribers when set() gets the value it already holds, so if the
    // drag ends back on the tab that was already active, the $effect
    // watching $currentView (which is what normally calls settleToView to
    // re-centre the spring) never fires. Without this direct call, the
    // highlight would freeze wherever the finger let go instead of
    // snapping to the tab's centre -- the "stuck between two icons" bug.
    settleToView(NAV[i].id);
  }
  function onPointerUp() {
    if (!dragActive) return;
    settleDragEnd();
  }
  function onPointerCancel() {
    if (!dragActive) return;
    settleDragEnd();
  }
  function onLostPointerCapture() {
    if (!dragActive) return;
    settleDragEnd();
  }

  let resizeHandler;
  onMount(() => {
    computeBaseSize();
    settleToView($currentView);
    pillEl.addEventListener('pointerdown', onPointerDown);
    pillEl.addEventListener('lostpointercapture', onLostPointerCapture);
    resizeHandler = () => settleToView($currentView);
    window.addEventListener('resize', resizeHandler);
  });
  onDestroy(() => {
    disarmWatchdog();
    detachDragListeners();
    if (!pillEl) return;
    pillEl.removeEventListener('pointerdown', onPointerDown);
    pillEl.removeEventListener('lostpointercapture', onLostPointerCapture);
    if (resizeHandler) window.removeEventListener('resize', resizeHandler);
    cancelAnimationFrame(navRAF);
  });

  $effect(() => {
    settleToView($currentView);
  });
</script>

<div class="navdock" class:kb-hidden={hidden}>
  <div class="navpill" bind:this={pillEl}>
    <div class="navpill-clip">
      <div class="nav-indicator" bind:this={indicatorEl}></div>
      {#each leftTabs as t, i (t.id)}
        <button class="navtab" data-guide="tab-{t.id}" bind:this={tabEls[i]} onclick={() => currentView.set(t.id)}>
          {#if t.id === 'home'}
            <svg viewBox="0 0 24 24" fill="none"><path d="M4 11.5 12 4l8 7.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10v9h12v-9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.4" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="4.2" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="1.1" fill="currentColor"/></svg>
          {/if}
          <span>{t.label}</span>
        </button>
      {/each}

      <div class="nav-fabslot"></div>

      {#each rightTabs as t, i (t.id)}
        <button class="navtab" data-guide="tab-{t.id}" bind:this={tabEls[half + i]} onclick={() => currentView.set(t.id)}>
          {#if t.id === 'history'}
            <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.2" stroke="currentColor" stroke-width="1.7"/><path d="M12 7.5V12l3 2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {:else}
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6Z" stroke="currentColor" stroke-width="1.6"/><path d="M19.4 12a7.4 7.4 0 0 0-.1-1.2l1.9-1.5-2-3.4-2.2.9a7.6 7.6 0 0 0-2.1-1.2L14.6 3H9.4l-.3 2.6a7.6 7.6 0 0 0-2.1 1.2l-2.2-.9-2 3.4L4.7 10.8a7.4 7.4 0 0 0 0 2.4L2.8 15l2 3.4 2.2-.9c.6.5 1.3.9 2.1 1.2l.3 2.6h5.2l.3-2.6c.8-.3 1.5-.7 2.1-1.2l2.2.9 2-3.4-1.9-1.5c.1-.4.1-.8.1-1.2Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
          {/if}
          <span>{t.label}</span>
        </button>
      {/each}
    </div>

    <button class="navfab" data-guide="tab-add" aria-label="Add expense" onclick={onAddClick}>
      <svg viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>
    </button>
  </div>
</div>
