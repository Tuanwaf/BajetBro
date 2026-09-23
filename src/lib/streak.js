import { liveQuery } from 'dexie';
import { readable, derived, writable, get } from 'svelte/store';
import db from './db.js';
import tier1 from '../assets/streak/tier1.webp';
import tier2 from '../assets/streak/tier2.webp';
import tier3 from '../assets/streak/tier3.webp';
import tier4 from '../assets/streak/tier4.webp';
import tier5 from '../assets/streak/tier5.webp';
import tier6 from '../assets/streak/tier6.webp';
import tier7 from '../assets/streak/tier7.webp';
import tier8 from '../assets/streak/tier8.webp';
import tier9 from '../assets/streak/tier9.webp';
import tier10 from '../assets/streak/tier10.webp';

// ---------------------------------------------------------------------------
// Streak rules
//
// - A day counts when at least one entry (any kind) is SAVED on that day, by
//   the real clock. Backdating an entry's date does not count for the day it
//   is backdated to -- what's recorded is the day you actually logged.
// - Active: +1 per logged day.
// - Freezes: every 7 logged days in a row earns one, holding at most 2. A
//   missed day with a freeze in hand spends it automatically -- the streak
//   stays active but doesn't grow that day.
// - Grey: a missed day with no freeze left. The number is kept but frozen,
//   and it stays grey for as long as the user is away -- nothing counts
//   down while they're gone. The relight only starts on the first day they
//   log again: 3 days in a row relights it, and those 3 days are added then
//   (37 -> grey -> 3 days -> 40).
// - Broken: missing a day once the 3-day relight has STARTED. The streak
//   can't be saved any more and the next logged day starts again from 1.
//
// Stored as nothing but the list of days logged (meta 'streakDays', local
// YYYY-MM-DD strings); everything else is replayed from it by
// computeStreak(), so the rules can never drift out of sync with stored
// counters.
// ---------------------------------------------------------------------------

export const FREEZE_EVERY = 7;
export const MAX_FREEZES = 2;
export const REVIVE_DAYS = 3;

// `pastel` is the soft card background behind that tier's buddy (Home card,
// Streak page hero) -- a gradient, so the Tycoon tier can go holographic.
// `fire` is [core, mid, edge] for that tier's SVG flame (StreakFlame);
// `rainbow` makes it cycle through hues (Tycoon); `glow` gives it a soft
// aura in its own colour (the top tiers).
export const TIERS = [
  { min: 1, max: 6, img: tier1, name: 'Starter', color: '#ff7a2e', pastel: 'linear-gradient(135deg, #fff1e6 0%, #ffe0cc 100%)', fire: ['#fff1a8', '#ffa02e', '#ff4d00'] },
  { min: 7, max: 29, img: tier2, name: 'On Fire', color: '#e5323b', pastel: 'linear-gradient(135deg, #fff0f0 0%, #ffdada 100%)', fire: ['#ffd9a8', '#ff4a3d', '#b3001e'] },
  { min: 30, max: 79, img: tier3, name: 'Planner', color: '#8b4dff', pastel: 'linear-gradient(135deg, #f5efff 0%, #e6dbff 100%)', fire: ['#f5e8ff', '#b07cff', '#5b21d6'] },
  { min: 80, max: 149, img: tier4, name: 'Grower', color: '#2f9e44', pastel: 'linear-gradient(135deg, #f0fbef 0%, #d6f2d3 100%)', fire: ['#eaffd9', '#5fd35a', '#1f7a2e'] },
  { min: 150, max: 199, img: tier5, name: 'Frosty', color: '#1e88e5', pastel: 'linear-gradient(135deg, #eef7ff 0%, #d3eaff 100%)', fire: ['#e8f6ff', '#56b4ff', '#1560c9'] },
  { min: 200, max: 249, img: tier6, name: 'Golden', color: '#e6a817', pastel: 'linear-gradient(135deg, #fffaea 0%, #ffedb8 100%)', fire: ['#fffbe0', '#ffd24a', '#d98a00'] },
  { min: 250, max: 299, img: tier7, name: 'Emperor', color: '#c81e1e', pastel: 'linear-gradient(135deg, #fff1ec 0%, #ffe1d9 55%, #fff2cf 100%)', fire: ['#fff3b0', '#ff5a3c', '#b8121f'] },
  { min: 300, max: 349, img: tier8, name: 'Cosmic', color: '#7c3aed', pastel: 'linear-gradient(135deg, #f3ecff 0%, #e6e2ff 50%, #e3f1ff 100%)', fire: ['#ffffff', '#b18cff', '#4c1fc0'], glow: true },
  { min: 350, max: 399, img: tier9, name: 'Tycoon', color: '#a855f7', pastel: 'linear-gradient(135deg, #ffe9f6 0%, #e9e6ff 35%, #dff4ff 70%, #e6ffef 100%)', fire: ['#ffffff', '#3ee8ff', '#ff3fb4'], rainbow: true },
  { min: 400, max: Infinity, img: tier10, name: 'Celestial', color: '#d4a017', pastel: 'linear-gradient(135deg, #fffef9 0%, #fdf6e3 55%, #fff0c7 100%)', fire: ['#ffffff', '#ffe7a0', '#d9a520'], glow: true },
];
export const GREY_FIRE = ['#f1f1f3', '#c9c9cf', '#9d9da5'];
export const GREY_PASTEL = 'linear-gradient(135deg, #f4f4f5 0%, #e7e7ea 100%)';
export function tierIndex(count) {
  if (count < 1) return 0;
  return TIERS.findIndex((t) => count >= t.min && count <= t.max);
}

// The buddy on show: the one picked on the Streak page (`choice`, a TIERS
// index) if it's been unlocked -- best streak ever reached its tier -- else
// the current streak's own tier. Brings that buddy's card and flame colours.
export function shownTierIndex(count, best, choice) {
  const t = choice == null ? null : TIERS[choice];
  return t && best >= t.min ? choice : tierIndex(count);
}

// Days that aren't a tier change but still get the full celebration.
const MILESTONES = new Set([3, 14, 50, 100, 200, 250, 300, 365, 400, 500, 730, 1000]);
export function isMilestone(count) {
  return MILESTONES.has(count) || (count > 1000 && count % 100 === 0);
}

export function localDay(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function nextDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + 1, 12));
}

// Replays every day from the first one logged up to `today`. Today itself
// only counts once it's logged -- not having logged YET isn't a miss.
export function computeStreak(dayList, today = localDay()) {
  const days = new Set(dayList);
  const sorted = [...days].sort();
  const res = {
    status: 'none', // 'none' | 'active' | 'grey'
    count: 0,
    freezes: 0,
    revive: 0, // logged days so far towards relighting a grey streak
    best: 0,
    todayLogged: days.has(today),
    freezesUsed: 0, // lifetime total -- lets Home notice a newly spent one
    frozenDays: [], // days a freeze covered (for the calendar)
  };
  if (!sorted.length) return res;
  let run = 0; // logged days since the last freeze was earned
  for (let d = sorted[0]; d <= today; d = nextDay(d)) {
    const logged = days.has(d);
    if (d === today && !logged) break;
    if (logged) {
      if (res.status === 'none') {
        res.status = 'active';
        res.count = 1;
        run = 1;
      } else if (res.status === 'active') {
        res.count++;
        run++;
      } else {
        res.revive++;
        if (res.revive === REVIVE_DAYS) {
          res.status = 'active';
          res.count += REVIVE_DAYS;
          res.revive = 0;
          run = REVIVE_DAYS;
        }
      }
      if (res.status === 'active' && run >= FREEZE_EVERY) {
        run -= FREEZE_EVERY;
        res.freezes = Math.min(MAX_FREEZES, res.freezes + 1);
      }
    } else if (res.status === 'active') {
      if (res.freezes > 0) {
        res.freezes--;
        res.freezesUsed++;
        res.frozenDays.push(d);
      } else {
        res.status = 'grey';
        res.revive = 0;
      }
    } else if (res.status === 'grey' && res.revive > 0) {
      // Only a relight already in progress can be broken -- a grey streak
      // just waits for the user to come back.
      res.status = 'none';
      res.count = 0;
      res.revive = 0;
      run = 0;
    }
    res.best = Math.max(res.best, res.count);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

// `undefined` until the first read from IndexedDB lands -- see streakReady.
export const streakDays = readable(undefined, (set) => {
  const sub = liveQuery(async () => (await db.meta.get('streakDays'))?.value ?? []).subscribe({
    next: set,
    error: (e) => console.error('[BajetBro] streak query failed:', e),
  });
  return () => sub.unsubscribe();
});

// The picked buddy (meta 'streakBuddy', a TIERS index), or null to follow
// the current streak. Cleared whenever a new buddy is unlocked, so the
// evolve celebration lands on the new one.
export const buddyChoice = readable(null, (set) => {
  const sub = liveQuery(async () => (await db.meta.get('streakBuddy'))?.value ?? null).subscribe({
    next: set,
    error: (e) => console.error('[BajetBro] buddy query failed:', e),
  });
  return () => sub.unsubscribe();
});
export function setBuddyChoice(i) {
  return i == null ? db.meta.delete('streakBuddy') : db.meta.put({ key: 'streakBuddy', value: i });
}

// Re-evaluated when the date rolls over (checked each minute, and whenever
// the app comes back to the foreground -- a PWA can sit suspended overnight).
export const today = readable(localDay(), (set) => {
  const tick = () => set(localDay());
  const iv = setInterval(tick, 60_000);
  document.addEventListener('visibilitychange', tick);
  return () => {
    clearInterval(iv);
    document.removeEventListener('visibilitychange', tick);
  };
});

// Dev mode's preview days. While set, everything streak-related (Home card,
// Streak page, simulated saves) runs on this list instead of the real one,
// so previewing never touches the user's actual streak.
export const devDays = writable(null);
// Bumped by the dev panel whenever it jumps to a new state, so the Home
// card re-baselines which preview freezes it has already announced.
export const devSeenReset = writable(0);
const effectiveDays = derived([streakDays, devDays], ([$real, $dev]) => $dev ?? $real ?? []);
// False for the first moment after launch, before the real days have loaded.
// Anything that compares against stored bookkeeping (the freeze-used check)
// must wait for this, or it would mistake "not loaded yet" for "no streak".
export const streakReady = derived(streakDays, ($d) => $d !== undefined);

export const streak = derived([effectiveDays, today], ([$days, $today]) => computeStreak($days, $today));
export { effectiveDays };

// What to celebrate after a save. Consumed by StreakCelebration (the big
// three.js moments) and StreakCard (the small daily bump).
// { kind: 'start'|'bump'|'milestone'|'tierup'|'revive'|'progress', before, after, freezeEarned }
export const celebration = writable(null);
// Set by StreakCard so the celebration's buddy can fly back into it.
export const cardBuddyEl = writable(null);
// True while the full-screen celebration owns the buddy.
export const celebrating = writable(false);
// Fired by StreakCelebration once its buddy has flown back into the card --
// the card rolls its number up and does its landing jelly then.
export const landed = writable(null);
// Open state of Home's Streak page -- a store so dev mode can open it too.
export const streakSheetOpen = writable(false);
// How long the last celebration took to get ready (ms) -- shown in dev mode.
export const lastSetupMs = writable(null);

export function classify(before, after) {
  const freezeEarned = after.freezes > before.freezes;
  let kind = null;
  if (before.status === 'grey' && after.status === 'active') kind = 'revive';
  else if (after.status === 'grey') kind = 'progress';
  else if (after.status === 'active') {
    if (before.status === 'none' || before.count === 0) kind = 'start';
    else if (tierIndex(after.count) !== tierIndex(before.count)) kind = 'tierup';
    else if (isMilestone(after.count)) kind = 'milestone';
    else kind = 'bump';
  }
  return kind ? { kind, before, after, freezeEarned } : null;
}

// Called after any entry is saved. Only the first save of a day does
// anything. The celebration is queued slightly later so the Add entry
// sheet's shrink-into-the-FAB animation finishes first.
export async function recordStreakActivity() {
  try {
    const t = localDay();
    const preview = get(devDays);
    const days = preview ?? (await db.meta.get('streakDays'))?.value ?? [];
    if (days.includes(t)) return;
    const before = computeStreak(days, t);
    const nextDays = [...days, t];
    if (preview) devDays.set(nextDays);
    else await db.meta.put({ key: 'streakDays', value: nextDays });
    const c = classify(before, computeStreak(nextDays, t));
    if (c?.kind === 'tierup' && !preview) await setBuddyChoice(null);
    if (c) setTimeout(() => celebration.set(c), 550);
  } catch (e) {
    console.error('[BajetBro] streak record failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Dev mode helpers (see DevStreakPanel)
// ---------------------------------------------------------------------------

// Plays a celebration without changing any data. `count` is the streak
// reached; `from` what it was before.
export function previewCelebration(kind, count, from = count - 1) {
  const mk = (status, c) => ({ status, count: c, freezes: 1, revive: 0, best: c, todayLogged: true, freezesUsed: 0, frozenDays: [] });
  if (kind === 'freeze') {
    const s = mk('active', count);
    s.freezes = 0;
    celebration.set({ kind, before: s, after: s, freezesUsed: 1, freezeEarned: false });
    return;
  }
  const before = kind === 'revive' ? mk('grey', from) : kind === 'start' ? mk('none', 0) : mk('active', from);
  celebration.set({ kind, before, after: mk('active', count), freezeEarned: false });
}

// Builds a day list ending at today: `pattern` is read oldest -> newest,
// '1' = logged, '0' = missed; the last char is today.
export function daysFromPattern(pattern) {
  const out = [];
  const n = pattern.length;
  for (let i = 0; i < n; i++) {
    if (pattern[i] !== '1') continue;
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (n - 1 - i));
    out.push(localDay(d));
  }
  return out;
}
