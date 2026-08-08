export const BUFFER_COLOR = '#e5323b';

export const BUFFER_LABEL_PRESETS = ['BNPL', 'Zakat', 'Emergency', 'Misc'];

// Palette offered when creating / editing a goal.
export const GOAL_COLORS = ['#f2557a', '#6e8bff', '#3ddc97', '#f2994a', '#c084f5', '#38c6d9', '#e7b34e'];

// Generic bank-card icons -- hand-drawn to match the app's own line-icon
// style (not pulled from an icon pack) so a bank/e-wallet without a real
// logo yet still gets something more specific than a bare initial. See
// BankIcon.svelte for the actual SVG per key.
export const BANK_ICONS = [
  { key: 'bank', label: 'Bank' },
  { key: 'wallet', label: 'Wallet' },
  { key: 'card', label: 'Card' },
  { key: 'cash', label: 'Cash' },
];

// Real bank/e-wallet/BNPL logos, vendored as SVGs under public/icons/banks/
// (from https://github.com/SnorSnor9998/Payment-Icon -- Malaysia-specific,
// no LICENSE file upstream, used here for personal/local use only). Add
// more by dropping a new <slug>.svg in that folder and an entry here.
export const BANK_LOGOS = [
  { slug: 'maybank', label: 'Maybank' },
  { slug: 'cimb', label: 'CIMB' },
  { slug: 'public-bank', label: 'Public Bank' },
  { slug: 'rhb', label: 'RHB' },
  { slug: 'hong-leong-bank', label: 'Hong Leong Bank' },
  { slug: 'ambank', label: 'AmBank' },
  { slug: 'bank-islam', label: 'Bank Islam' },
  { slug: 'bank-muamalat', label: 'Bank Muamalat' },
  { slug: 'bank-rakyat', label: 'Bank Rakyat' },
  { slug: 'bsn', label: 'BSN' },
  { slug: 'affin-bank', label: 'Affin Bank' },
  { slug: 'alliance-bank', label: 'Alliance Bank' },
  { slug: 'agro-bank', label: 'Agrobank' },
  { slug: 'mbsb', label: 'MBSB Bank' },
  { slug: 'ocbc', label: 'OCBC' },
  { slug: 'uob', label: 'UOB' },
  { slug: 'hsbc', label: 'HSBC' },
  { slug: 'standard-chartered', label: 'Standard Chartered' },
  { slug: 'gx-bank', label: 'GXBank' },
  { slug: 'boost-bank', label: 'Boost Bank' },
  { slug: 'ryt-bank', label: 'Ryt Bank' },
  { slug: 'tng', label: 'Touch \'n Go eWallet' },
  { slug: 'grabpay', label: 'GrabPay' },
  { slug: 'boost', label: 'Boost' },
  { slug: 'shopeepay', label: 'ShopeePay' },
  { slug: 'mae', label: 'MAE' },
  { slug: 'alipay', label: 'Alipay' },
  { slug: 'alipayplus', label: 'Alipay+' },
  { slug: 'atome', label: 'Atome' },
  { slug: 'grabpaylater', label: 'GrabPayLater' },
  { slug: 'spaylater', label: 'SPayLater' },
];

// Card face designs -- background + matching text color + a fixed line-art
// motif per design (see CardPattern.svelte's `kind` prop), independent of
// the border/shadow accent color already offered elsewhere. "classic"
// matches the app's normal light panel look and is the default for any
// bank that predates this field.
// `accent` is the border/shadow color used for every design except classic
// (which uses the bank's own chosen color instead) -- a solid color pulled
// from that design's own gradient, so the border matches its style instead
// of a one-size-fits-all black.
export const CARD_DESIGNS = [
  {
    key: 'classic', label: 'Classic',
    bg: 'var(--panel)', fg: 'var(--hi)', dim: 'var(--dim)',
    pattern: 'arcs', patternColor: 'var(--stroke-2)', patternOpacity: 0.07,
  },
  {
    key: 'midnight', label: 'Midnight',
    bg: 'linear-gradient(135deg, #2a2f45, #0b0d16)', fg: '#f4f5fa', dim: 'rgba(244,245,250,0.62)',
    pattern: 'stars', patternColor: '#ffffff', patternOpacity: 0.14, accent: '#232840',
  },
  {
    key: 'ocean', label: 'Ocean',
    bg: 'linear-gradient(135deg, #1f7fae, #0b3b5c)', fg: '#ffffff', dim: 'rgba(255,255,255,0.68)',
    pattern: 'swell', patternColor: '#ffffff', patternOpacity: 0.18, accent: '#155a82',
  },
  {
    key: 'sunset', label: 'Sunset',
    bg: 'linear-gradient(135deg, #ff8a5c, #7b3fe4)', fg: '#ffffff', dim: 'rgba(255,255,255,0.72)',
    pattern: 'sun', patternColor: '#ffffff', patternOpacity: 0.18, accent: '#a8449a',
  },
  {
    key: 'forest', label: 'Forest',
    bg: 'linear-gradient(135deg, #2a7a52, #0d3324)', fg: '#ffffff', dim: 'rgba(255,255,255,0.66)',
    pattern: 'canopy', patternColor: '#ffffff', patternOpacity: 0.16, accent: '#1f5b3d',
  },
  {
    key: 'graphite', label: 'Graphite',
    bg: 'linear-gradient(135deg, #565c68, #1c1e24)', fg: '#ffffff', dim: 'rgba(255,255,255,0.66)',
    pattern: 'grid', patternColor: '#ffffff', patternOpacity: 0.16, accent: '#33363d',
  },
  {
    key: 'maroon', label: 'Maroon',
    bg: 'linear-gradient(135deg, #b3283f, #3d0a12)', fg: '#ffffff', dim: 'rgba(255,255,255,0.68)',
    pattern: 'rings', patternColor: '#ffffff', patternOpacity: 0.16, accent: '#6b0f1a',
  },
  {
    key: 'amber', label: 'Amber',
    bg: 'linear-gradient(135deg, #ffcf4d, #e6720e)', fg: '#2b1400', dim: 'rgba(43,20,0,0.6)',
    pattern: 'rays', patternColor: '#2b1400', patternOpacity: 0.14, accent: '#c97b12',
  },
];

export function getCardDesign(key) {
  return CARD_DESIGNS.find((d) => d.key === key) ?? CARD_DESIGNS[0];
}

// Only "classic" (the plain light look) can take a custom border/shadow
// color -- every other design already has a deliberate color scheme of its
// own, so it uses that design's own accent (a solid color pulled from its
// gradient) instead of the bank's chosen color, which would clash.
export function cardBorderColor(bank) {
  if (!bank.design || bank.design === 'classic') return bank.color;
  return getCardDesign(bank.design).accent;
}

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
