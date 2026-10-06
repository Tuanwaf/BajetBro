import { writable } from 'svelte/store';

// Status-bar style experiment (dev mode only, per device).
//
// iOS 26 started drawing its own "Liquid Glass" blur over the top of
// installed web apps that use black-translucent, and iOS 27 made it much
// stronger and whiter (WebKit bug 325807). Page CSS can't switch it off.
// The one known escape: when a full-width position:fixed box touches the
// top edge, WebKit skips its blur and fills the status-bar band with that
// box's colour. v3.4.2 coloured .status-bar-blur itself and iOS ignored it
// (tall blur stayed); v3.4.3's plain 11px strip, .sb-edge, had
// pointer-events:none and iOS never saw it. v3.4.4 makes the strip
// hit-testable and adds variants that hide our own frost. Picked in DevStreakPanel; applied as
// <html data-sb="..."> and styled in app.css.

export const STATUS_BAR_STYLES = [
  { id: 'current', label: 'Current (iOS glass)' },
  { id: 'edge', label: 'Edge strip solid' },
  { id: 'edge15', label: 'Edge strip 15%' },
  { id: 'edge-noblur', label: 'Edge strip solid, no app blur' },
  { id: 'noblur', label: 'No app blur (iOS only)' },
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
