import { writable } from 'svelte/store';

// Status-bar style experiment (dev mode only, per device).
//
// iOS 26 started drawing its own "Liquid Glass" blur over the top of
// installed web apps that use black-translucent, and iOS 27 made it much
// stronger and whiter (WebKit bug 325807). Page CSS can't switch it off.
// Coloured top strips (v3.4.2-3.4.4) only recoloured the status band; the
// tall glass stayed. v3.4.5 tried muffinman.io's tinted blur, which left a
// hard seam against iOS's glass; v3.4.6 fades it into that glass instead.
// Picked in DevStreakPanel; applied as
// <html data-sb="..."> and styled in app.css.

export const STATUS_BAR_STYLES = [
  { id: 'current', label: 'Current (iOS glass)' },
  { id: 'blend', label: 'Blend 8px · 45% · 32px fade' },
  { id: 'blend-light', label: 'Blend 8px · 20% · 32px fade' },
  { id: 'blend-long', label: 'Blend 8px · 45% · 56px fade' },
];

const KEY = 'bb-statusbar-style';

function load() {
  try {
    const v = localStorage.getItem(KEY);
    return STATUS_BAR_STYLES.some((s) => s.id === v) ? v : 'current';
  } catch {
    return 'current';
  }
}

export const statusBarStyle = writable(load());

statusBarStyle.subscribe((v) => {
  if (v === 'current') delete document.documentElement.dataset.sb;
  else document.documentElement.dataset.sb = v;
  try {
    if (v === 'current') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, v);
  } catch {}
});

// Dev readout: what the top of the screen measures on this device, to see
// whether iOS 27 changed the safe-area inset (which sizes our own frost).
export function topMetrics() {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;height:env(safe-area-inset-top,0px);visibility:hidden';
  document.body.appendChild(probe);
  const inset = probe.offsetHeight;
  probe.remove();
  const blur = document.querySelector('.status-bar-blur')?.offsetHeight ?? 0;
  const standalone = matchMedia('(display-mode: standalone)').matches;
  return `inset ${inset}px · our blur ${blur}px · view ${innerWidth}×${innerHeight} · screen ${screen.width}×${screen.height} · ${standalone ? 'installed' : 'browser'}`;
}
