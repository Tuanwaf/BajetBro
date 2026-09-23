<script>
  // Dev mode (Settings -> tap the version number 7 times; always on under
  // the dev server). Everything here runs in a PREVIEW: `devDays` replaces
  // the real streak days for the Home card, the Streak page and simulated
  // saves, so testing never touches the user's actual streak. "Exit preview"
  // hands everything back to the real data.
  import { get } from 'svelte/store';
  import db from '../db.js';
  import { currentView } from '../viewStore.js';
  import { showToast } from '../toast.js';
  import { previewUpdateBanner } from '../updates.js';
  import {
    devDays, devSeenReset, streak, celebration, streakSheetOpen, lastSetupMs,
    daysFromPattern, recordStreakActivity, previewCelebration, localDay, TIERS,
  } from '../streak.js';

  let previewing = $derived($devDays != null);

  // ---- celebrations ----
  // One representative count per tier for each kind.
  const MILESTONE_AT = [3, 14, 50, 100, 200];
  const RELIGHT_AT = [5, 20, 40, 90, 160];
  const allCelebrations = [
    { label: 'Start (day 1)', kind: 'start', count: 1, from: 0 },
    ...TIERS.map((t, i) => ({ label: `Milestone ${MILESTONE_AT[i]}`, kind: 'milestone', count: MILESTONE_AT[i], tier: i })),
    ...TIERS.slice(1).map((t, i) => ({ label: `Evolve → ${t.name} (${t.min})`, kind: 'tierup', count: t.min, tier: i + 1 })),
    ...TIERS.map((t, i) => ({ label: `Relight ${RELIGHT_AT[i] - 3}→${RELIGHT_AT[i]}`, kind: 'revive', count: RELIGHT_AT[i], from: RELIGHT_AT[i] - 3, tier: i })),
    ...TIERS.map((t, i) => ({ label: `Freeze used · ${t.name}`, kind: 'freeze', count: [5, 20, 40, 90, 160][i], tier: i })),
  ];

  // The Home card shows the state from before the celebration and rolls up
  // to this once the buddy lands, so the preview days are set to the
  // "after" state first.
  function preview(days) {
    devSeenReset.update((n) => n + 1);
    devDays.set(days);
  }
  function play(c) {
    preview(daysFromPattern('1'.repeat(c.count)));
    streakSheetOpen.set(false);
    currentView.set('home');
    setTimeout(() => previewCelebration(c.kind, c.count, c.from ?? c.count - 1), 300);
  }
  function playBump() {
    preview(daysFromPattern('1'.repeat(12)));
    streakSheetOpen.set(false);
    currentView.set('home');
    setTimeout(() => celebration.set({ kind: 'bump', before: { ...get(streak), count: 11 }, after: get(streak), freezeEarned: false }), 300);
  }

  let playingAll = $state(false);
  async function playAll() {
    playingAll = true;
    for (const c of allCelebrations) {
      if (!playingAll) break;
      play(c);
      // Wait for it to start, then for it to finish (auto-exits on its own).
      await new Promise((r) => setTimeout(r, 600));
      await new Promise((r) => {
        const unsub = celebration.subscribe((v) => {
          if (v == null) {
            queueMicrotask(() => unsub());
            r();
          }
        });
      });
      await new Promise((r) => setTimeout(r, 1400));
    }
    playingAll = false;
  }

  // ---- states for the Home card + Streak page ----
  const grey37 = '1'.repeat(35) + '00' + '11' + '0';
  const states = [
    { label: 'Fresh (never logged)', pattern: '' },
    ...TIERS.map((t, i) => ({ label: `${t.name} · day ${[4, 12, 45, 100, 200][i]}`, pattern: '1'.repeat([4, 12, 45, 100, 200][i]) })),
    { label: 'Not logged today yet', pattern: '1'.repeat(20) + '0' },
    { label: '1 freeze left', pattern: '1'.repeat(14) + '0' + '1'.repeat(3) },
    { label: 'Freeze just used', pattern: '1'.repeat(9) + '0' + '0' },
    { label: 'No freezes left', pattern: '1'.repeat(14) + '00' + '1'.repeat(3) },
    { label: 'Grey 37 · away 5 days', pattern: grey37 + '00000' },
    { label: 'Grey 37 · 1/3 today', pattern: grey37 + '1' },
    { label: 'Grey 37 · 2/3 (log today → 40)', pattern: grey37 + '11' + '0' },
    { label: 'Ended (best 12)', pattern: '1'.repeat(12) + '000' + '1' + '0' + '0' },
  ];
  function setState(st) {
    preview(st.pattern ? daysFromPattern(st.pattern) : []);
    showToast(`Preview: ${st.label}`);
  }
  let jumpTo = $state(30);
  function jump() {
    const n = Math.max(0, Math.min(2000, Math.round(Number(jumpTo) || 0)));
    preview(daysFromPattern('1'.repeat(n) + '0'));
    showToast(`Preview: day ${n}, not logged today`);
  }

  // ---- simulation ----
  function ensurePreview() {
    if (get(devDays) == null) preview([]);
  }
  async function logToday() {
    ensurePreview();
    streakSheetOpen.set(false);
    currentView.set('home');
    setTimeout(recordStreakActivity, 300);
  }
  // Time travel: shifting every preview day back by one = "tomorrow".
  function nextDay() {
    ensurePreview();
    devDays.update((days) =>
      days.map((k) => {
        const [y, m, d] = k.split('-').map(Number);
        return localDay(new Date(y, m - 1, d - 1, 12));
      })
    );
    showToast('⏭ It is now the next day');
  }
  // Starts the preview from the user's real streak, to rehearse their own
  // next few days.
  async function copyReal() {
    preview((await db.meta.get('streakDays'))?.value ?? []);
    showToast('Preview: copy of your real streak');
  }

  function openStreakPage() {
    currentView.set('home');
    streakSheetOpen.set(true);
  }
  function exitPreview() {
    playingAll = false;
    devDays.set(null);
    showToast('Back to your real streak');
  }
  async function turnOff() {
    exitPreview();
    await db.meta.put({ key: 'devMode', value: false });
    showToast('Dev mode off');
  }
</script>

<div class="section-hd"><h3>Dev mode · Streak</h3></div>
<div class="card dev">
  <div class="status" class:on={previewing}>
    {#if previewing}
      <b>Previewing</b> — Home and the Streak page show test data. Your real streak is untouched.
    {:else}
      Showing your <b>real</b> streak. Anything below switches to a safe preview.
    {/if}
  </div>
  <div class="now">
    Now: <b>{$streak.status}</b> · {$streak.count} days · {$streak.freezes} freezes{#if $streak.status === 'grey'} · relight {$streak.revive}/3{/if}{#if $streak.todayLogged} · logged today{/if}
    {#if $lastSetupMs != null}<br />Last celebration ready in {$lastSetupMs} ms{/if}
  </div>

  <div class="field-lbl">Animations</div>
  <div class="grid">
    <button class="chip ghost" onclick={playBump}>Daily bump (card)</button>
    {#each allCelebrations as c}
      <button class="chip ghost" onclick={() => play(c)}>{c.label}</button>
    {/each}
  </div>
  {#if playingAll}
    <button class="io-btn" onclick={() => (playingAll = false)}>Stop after this one</button>
  {:else}
    <button class="io-btn" onclick={playAll}>▶ Play all animations in order</button>
  {/if}

  <div class="field-lbl">Home card & Streak page states</div>
  <div class="grid">
    {#each states as st}
      <button class="chip ghost" onclick={() => setState(st)}>{st.label}</button>
    {/each}
  </div>
  <div class="jump">
    <input class="note-input num" type="number" inputmode="numeric" min="0" bind:value={jumpTo} />
    <button class="chip ghost" onclick={jump}>Jump to day</button>
  </div>
  <button class="io-btn" onclick={openStreakPage}>Open the Streak page</button>

  <div class="field-lbl">Simulate days</div>
  <p class="hint" style="margin:0 0 8px;">Play through real rules: log today, skip to the next day, repeat. Skipping a day with a freeze in hand plays the freeze animation, the same way opening the app the next morning would.</p>
  <div class="sim">
    <button class="save-btn" style="margin-top:0;" onclick={logToday}>Log today</button>
    <button class="io-btn" onclick={nextDay}>Next day ⏭</button>
  </div>
  <button class="chip ghost" style="margin-top:8px;" onclick={copyReal}>Start from a copy of my real streak</button>

  <div class="field-lbl">App updates</div>
  <button class="io-btn" onclick={previewUpdateBanner}>Preview the update banner</button>

  <div class="sim" style="margin-top:14px;">
    <button class="io-btn" disabled={!previewing} onclick={exitPreview}>Exit preview</button>
    <button class="io-btn" onclick={turnOff}>Turn off dev mode</button>
  </div>
</div>

<style>
  .dev { border-style: dashed; }
  .status { font-size: 12.5px; line-height: 1.45; color: var(--lo); padding: 10px 12px; border-radius: 12px; background: var(--panel-2); }
  .status.on { background: rgba(58, 141, 222, 0.14); color: var(--hi); }
  .now { font-size: 12px; color: var(--dim); margin-top: 8px; font-family: var(--mono); line-height: 1.5; }
  .grid { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .grid .chip { font-size: 12px; }
  .jump { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
  .jump .note-input { width: 90px; padding: 8px 10px; }
  .sim { display: flex; gap: 8px; }
  .sim > * { flex: 1; }
  .io-btn:disabled { opacity: 0.4; }
</style>
