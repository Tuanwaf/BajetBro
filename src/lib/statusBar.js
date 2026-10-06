import { writable } from 'svelte/store';

// Status-bar style experiment (dev mode only, per device).
//
// iOS 26 started drawing its own "Liquid Glass" blur over the top of
// installed web apps that use black-translucent, and iOS 27 made it much
// stronger and whiter (WebKit bug 325807). Page CSS can't switch it off.
// The one known escape: when a full-width position:fixed box touches the
// top edge, WebKit skips its blur and fills the status-bar band with that
// box's colour. v3.4.2 coloured .status-bar-blur itself and iOS ignored it
// (tall blur stayed), so v3.4.3 adds a plain 11px strip, .sb-edge, and
// tests it solid and semi-transparent. Picked in DevStreakPanel; applied as
// <html data-sb="..."> and styled in app.css.

export const STATUS_BAR_STYLES = [
  { id: 'current', label: 'Current (iOS glass)' },
  { id: 'edge', label: 'Edge strip solid' },
  { id: 'edge50', label: 'Edge strip 50%' },
  { id: 'edge15', label: 'Edge strip 15%' },
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
