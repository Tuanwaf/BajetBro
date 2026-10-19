<script>
  // Admin mode (Settings -> tap the version number 7 times, then the
  // password). Unlike the old dev previews, everything here edits the REAL
  // streak on this device, so the Home card, the Streak page and real saves
  // all behave exactly as they will for the user. The first edit stashes the
  // untouched days (meta 'streakDaysAdminBackup') -- "Restore" puts them back.
  import { liveQuery } from 'dexie';
  import db from '../db.js';
  import { currentView } from '../viewStore.js';
  import { showToast } from '../toast.js';
  import { previewUpdateBanner } from '../updates.js';
  import {
    streak, streakDays, buddyChoice, setBuddyChoice, streakSheetOpen, lastSetupMs,
    recordStreakActivity, buildStreakDays, adminSetDays, localDay, computeStreak,
    TIERS, tierIndex, shownTierIndex, MAX_FREEZES, FREEZE_EVERY, REVIVE_DAYS,
  } from '../streak.js';

  const backupQ = liveQuery(async () => (await db.meta.get('streakDaysAdminBackup'))?.value ?? null);
  // raw: a deep $state proxy can't be written back to IndexedDB.
  let backup = $state.raw(null);
  $effect(() => {
    const sub = backupQ.subscribe({ next: (v) => (backup = v) });
    return () => sub.unsubscribe();
  });

  let shownTier = $derived(TIERS[shownTierIndex($streak.count, $streak.best, $buddyChoice)]);

  // ---- set the streak ----
  // Starts from whatever the real streak is now. For an active streak the
  // number is TODAY's day number: "200, not logged" means Home shows 199
  // and logging today makes it 200 (and plays the evolve). A streak on hold
  // keeps its frozen number either way.
  let fStatus = $state('active');
  let fCount = $state(0);
  let fToday = $state(false);
  let fFreezes = $state(0);
  let fRevive = $state(0);
  let fBest = $state(0);
  // The live store lags a write by a tick, so callers that just wrote pass
  // the new state in.
  function loadCurrent(s = $streak) {
    fStatus = s.status === 'none' ? 'active' : s.status;
    fCount = s.status === 'grey' || s.todayLogged ? s.count : s.count + 1;
    fToday = s.todayLogged;
    fFreezes = s.freezes;
    fRevive = s.revive;
    fBest = s.best;
  }
  // Follows the real streak whenever it changes (Apply, Log today, a real save).
  $effect(() => {
    if ($streakDays !== undefined) loadCurrent(computeStreak($streakDays));
  });

  const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));
  let fDay = $derived(clampInt(fCount, 0, 3000));
  // What the streak count actually is right now (before today's log).
  let effCount = $derived(fStatus === 'grey' || fToday ? fDay : Math.max(0, fDay - 1));
  let maxFreezes = $derived(Math.min(MAX_FREEZES, Math.floor(effCount / FREEZE_EVERY)));
  let fTier = $derived(TIERS[tierIndex(Math.max(1, fDay))]);
  let fNext = $derived(TIERS[tierIndex(Math.max(1, fDay)) + 1] ?? null);

  async function apply(target, label) {
    const days = buildStreakDays(target);
    if (!days) {
      showToast("Can't build that exact state — try fewer freezes");
      return false;
    }
    await adminSetDays(days);
    showToast(label ?? 'Streak updated');
    loadCurrent(computeStreak(days));
    return true;
  }
  async function applyForm() {
    const count = effCount;
    const status = count === 0 ? 'none' : fStatus;
    const todayLogged = status === 'none' ? false : fToday;
    const target = {
      status,
      count,
      todayLogged,
      freezes: Math.min(clampInt(fFreezes, 0, MAX_FREEZES), maxFreezes),
      revive: status === 'grey' && todayLogged ? Math.max(1, clampInt(fRevive, 0, REVIVE_DAYS - 1)) : clampInt(fRevive, 0, REVIVE_DAYS - 1),
      best: Math.max(count, clampInt(fBest, 0, 3000)),
    };
    await apply(target);
  }

  // One tap: the day before a buddy unlocks, not logged yet today -- then
  // "Log today" (or a real save) plays the unlock.
  async function eveOf(t) {
    const count = t.min - 1;
    // best = count keeps the buddy locked until the unlock.
    if (await apply({ status: 'active', count, todayLogged: false, freezes: Math.min(MAX_FREEZES, Math.floor(count / FREEZE_EVERY)), best: count }, `Day ${count} — log today to unlock ${t.name}`)) {
      await setBuddyChoice(null);
    }
  }

  // ---- day controls ----
  function goHome() {
    streakSheetOpen.set(false);
    currentView.set('home');
  }
  function logToday() {
    goHome();
    setTimeout(recordStreakActivity, 300);
  }
  async function unlogToday() {
    const t = localDay();
    const days = ($streakDays ?? []).filter((d) => d !== t);
    await adminSetDays(days);
    showToast("Today's log removed");
    loadCurrent(computeStreak(days));
  }
  // Time travel: shifting every day back by one = "tomorrow". A freeze spent
  // overnight plays its animation on the Home card, as on a real morning.
  async function nextDay() {
    const shifted = ($streakDays ?? []).map((k) => {
      const [y, m, d] = k.split('-').map(Number);
      return localDay(new Date(y, m - 1, d - 1, 12));
    });
    goHome();
    await adminSetDays(shifted, { announceFreezes: true });
    const s = computeStreak(shifted);
    showToast(`⏭ Next day · ${s.status === 'grey' ? 'on hold' : s.status} · ${s.count} days`);
    loadCurrent(s);
  }

  // ---- backup ----
  async function restore() {
    if (!backup) return;
    const days = backup.days;
    await db.meta.put({ key: 'streakFreezesSeen', value: computeStreak(days).freezesUsed });
    await db.meta.put({ key: 'streakDays', value: days });
    await db.meta.delete('streakDaysAdminBackup');
    showToast('Real streak restored');
    loadCurrent(computeStreak(days));
  }
  async function keepCurrent() {
    await db.meta.delete('streakDaysAdminBackup');
    showToast('Kept the current streak as your real one');
  }
  let confirmLock = $state(false);
  async function lock() {
    await db.meta.put({ key: 'devMode', value: false });
    showToast('Admin mode locked');
  }
  const fmt = (iso) => new Date(iso).toLocaleString('en-MY', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
</script>

<div class="section-hd"><h3>Admin · Streak buddy</h3></div>
<div class="card admin">
  <div class="now">
    <img src={shownTier.img} alt="" />
    <div>
      <b>{$streak.status === 'grey' ? 'On hold' : $streak.status === 'none' ? 'No streak' : 'Active'} · {$streak.count} day{$streak.count === 1 ? '' : 's'}</b>
      <span>{$streak.freezes} freeze{$streak.freezes === 1 ? '' : 's'} · best {$streak.best}{#if $streak.status === 'grey'}{' · '}relight {$streak.revive}/{REVIVE_DAYS}{/if}</span>
      <span>{$streak.todayLogged ? 'Logged today' : 'Not logged today'} · showing {shownTier.name}</span>
      {#if $lastSetupMs != null}<span>Last celebration ready in {$lastSetupMs} ms</span>{/if}
    </div>
  </div>
  <p class="warn">These change your <b>real</b> streak on this device.{#if backup} Original saved {fmt(backup.at)}.{/if}</p>

  <div class="field-lbl">Set the streak</div>
  <div class="row">
    <span class="lbl">{fStatus === 'grey' ? 'Streak days (on hold)' : 'Today is day'}</span>
    <input class="note-input num" type="number" inputmode="numeric" min="0" max="3000" bind:value={fCount} />
  </div>
  {#if fDay > 0}
    <div class="row">
      <span class="lbl">Status</span>
      <div class="seg">
        <button class:on={fStatus !== 'grey'} onclick={() => (fStatus = 'active')}>Active</button>
        <button class:on={fStatus === 'grey'} onclick={() => (fStatus = 'grey')}>On hold</button>
      </div>
    </div>
    <div class="row">
      <span class="lbl">Today</span>
      <div class="seg">
        <button class:on={!fToday} onclick={() => (fToday = false)}>Not logged</button>
        <button class:on={fToday} onclick={() => (fToday = true)}>Logged</button>
      </div>
    </div>
    {#if fStatus === 'grey'}
      <div class="row">
        <span class="lbl">Relight days done</span>
        <div class="seg">
          {#each [0, 1, 2] as r}
            <button class:on={fRevive === r} disabled={fToday && r === 0} onclick={() => (fRevive = r)}>{r}/{REVIVE_DAYS}</button>
          {/each}
        </div>
      </div>
    {:else}
      <div class="row">
        <span class="lbl">Freezes</span>
        <div class="seg">
          {#each [0, 1, 2] as f}
            <button class:on={fFreezes === f} disabled={f > maxFreezes} onclick={() => (fFreezes = f)}>{f}</button>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
  <div class="row">
    <span class="lbl">Best ever <small>(unlocks buddies)</small></span>
    <input class="note-input num" type="number" inputmode="numeric" min="0" max="3000" bind:value={fBest} />
  </div>
  {#if fDay > 0}
    <p class="hint" style="margin:2px 0 8px;">
      {#if fStatus !== 'grey' && !fToday}
        Home will show <b>{effCount}</b>. Tap <b>Log today</b> after Apply to reach day {fDay}{#if tierIndex(Math.max(1, effCount)) !== tierIndex(fDay) && effCount > 0}{' '}and unlock <b>{fTier.name}</b>{/if}.
      {:else}
        Home will show <b>{fDay}</b> · buddy <b>{fTier.name}</b>{#if fNext}{' · '}{fNext.name} at {fNext.min}{/if}.
      {/if}
      Apply itself never plays an animation.
    </p>
  {/if}
  <div class="pair">
    <button class="io-btn" onclick={() => loadCurrent()}>Reset form</button>
    <button class="save-btn" style="margin-top:0;" onclick={applyForm}>Apply</button>
  </div>

  <div class="field-lbl">Unlock a buddy</div>
  <p class="hint" style="margin:0 0 8px;">Makes today that buddy's first day, not logged yet. Then tap <b>Log today</b> (or save any entry) to watch the unlock.</p>
  <div class="grid">
    {#each TIERS.slice(1) as t}
      <button class="chip ghost" onclick={() => eveOf(t)}>{t.name} · day {t.min}</button>
    {/each}
  </div>

  <div class="field-lbl">Days</div>
  <div class="pair">
    <button class="save-btn" style="margin-top:0;" disabled={$streak.todayLogged} onclick={logToday}>Log today</button>
    <button class="io-btn" onclick={nextDay}>Next day ⏭</button>
  </div>
  <button class="io-btn" style="margin-top:8px;" disabled={!$streak.todayLogged} onclick={unlogToday}>Undo today's log</button>
  <p class="hint" style="margin:8px 0 0;">Log today plays the real celebration on Home without adding an entry. Next day moves time forward: skip a day with a freeze in hand to see the freeze animation.</p>

  <div class="field-lbl">Buddy</div>
  <button class="io-btn" disabled={$buddyChoice == null} onclick={() => setBuddyChoice(null).then(() => showToast('Buddy follows the streak again'))}>Clear picked buddy{#if $buddyChoice != null} ({TIERS[$buddyChoice]?.name}){/if}</button>

  <div class="field-lbl">Original streak</div>
  {#if backup}
    <div class="pair">
      <button class="io-btn" onclick={restore}>Restore original</button>
      <button class="io-btn" onclick={keepCurrent}>Keep current</button>
    </div>
    <p class="hint" style="margin:8px 0 0;">Restore puts back your streak from before the first admin change ({backup.days.length} logged days).</p>
  {:else}
    <p class="hint" style="margin:0;">No changes yet — your original streak is saved automatically on the first edit.</p>
  {/if}

  <div class="field-lbl">App updates</div>
  <button class="io-btn" onclick={previewUpdateBanner}>Preview the update banner</button>

  {#if confirmLock}
    <div class="pair" style="margin-top:14px;">
      <button class="io-btn" onclick={() => (confirmLock = false)}>Cancel</button>
      <button class="save-btn" style="margin-top:0;" onclick={lock}>Lock admin mode</button>
    </div>
  {:else}
    <button class="io-btn" style="margin-top:14px;" onclick={() => (confirmLock = true)}>Lock admin mode</button>
  {/if}
</div>

<style>
  .admin { border-style: dashed; }
  .now { display: flex; gap: 12px; align-items: center; }
  .now img { width: 56px; height: 56px; object-fit: contain; flex: none; }
  .now div { display: flex; flex-direction: column; gap: 2px; font-size: 12px; color: var(--dim); font-family: var(--mono); line-height: 1.4; }
  .now b { font-size: 14px; color: var(--hi); font-family: var(--body); }
  .warn { font-size: 12px; line-height: 1.45; color: var(--hi); padding: 9px 12px; border-radius: 12px; background: rgba(229, 50, 59, 0.1); margin: 10px 0 0; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  .lbl { font-size: 13.5px; color: var(--lo); }
  .lbl small { color: var(--dim); font-size: 11px; }
  .row .note-input { width: 96px; padding: 8px 10px; text-align: right; }
  .seg { display: flex; gap: 3px; padding: 3px; border: 2px solid var(--stroke-2); border-radius: 12px; background: var(--panel-2); }
  .seg button { border: none; background: none; border-radius: 9px; padding: 6px 11px; font-size: 12.5px; font-weight: 700; color: var(--dim); }
  .seg button.on { background: var(--gold); color: var(--accent-ink); }
  .seg button:disabled { opacity: 0.35; }
  .grid { display: flex; flex-wrap: wrap; gap: 6px; }
  .grid .chip { font-size: 12px; }
  .pair { display: flex; gap: 8px; }
  .pair > * { flex: 1; }
  .io-btn:disabled, .save-btn:disabled { opacity: 0.4; }
</style>
