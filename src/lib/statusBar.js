import { writable } from 'svelte/store';

// Status-bar style experiment (dev mode only, per device).
//
// iOS 26 started drawing its own "Liquid Glass" blur over the top of
// installed web apps that use black-translucent, and iOS 27 made it much
// stronger and whiter (WebKit bug 325807). Page CSS can't switch it off.
// The one known escape: when a full-width position:fixed box touches the
// top edge, WebKit skips its blur and fills the status-bar band with that
// box's colour. These variants test whether a SEMI-transparent colour keeps
// some of the old translucent look. Picked in DevStreakPanel; applied as
// <html data-sb="..."> and styled in app.css (.status-bar-blur).

export const STATUS_BAR_STYLES = [
  { id: 'current', label: 'Current (iOS glass)' },
  { id: 'solid', label: 'Solid cream' },
  { id: 'cream70', label: 'Cream 70% + blur' },
  { id: 'cream40', label: 'Cream 40% + blur' },
  { id: 'cream15', label: 'Cream 15% + blur' },
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
