<script>
  import { formatDate, formatTime } from '../format.js';

  // One box, one tap edits both date and time together. The real control
  // (type="datetime-local") is an invisible layer stretched over a plain
  // styled display -- rendering it directly (tried first, in AddExpenseSheet)
  // clipped off the sheet's right edge on-device: the combined control's
  // native segmented layout has an intrinsic width iOS won't shrink below,
  // wider than a sheet like this has room for. Invisible, that native sizing
  // quirk no longer has anything to visibly clip -- only the decorative text
  // needs to fit, and that's plain flex content this fully controls.
  let { value = $bindable(''), min = '', max = '' } = $props();
</script>

<div class="date-time-field">
  <svg class="cal-icon" viewBox="0 0 24 24" fill="none" width="16" height="16" aria-hidden="true">
    <rect x="3.5" y="5" width="17" height="15" rx="3" stroke="currentColor" stroke-width="1.8"/>
    <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
  </svg>
  <span class="dt-display">{value ? `${formatDate(value)} · ${formatTime(value)}` : 'Pick a date & time'}</span>
  <input
    class="dt-native"
    type="datetime-local"
    bind:value
    min={min || undefined}
    max={max || undefined}
    aria-label="Date and time"
  />
</div>

<style>
  /* Same chrome as .note-input (app.css). position:relative + overflow:
     hidden is load-bearing -- it's what clips .dt-native down to this box's
     own size, since that real control's on-device rendering won't shrink to
     fit on its own (see the script comment above). Clipping it is harmless
     here specifically because it's invisible -- there's nothing for the clip
     to visibly cut off. */
  .date-time-field {
    position: relative;
    display: flex; align-items: center; justify-content: center; gap: 8px;
    width: 100%; background: var(--panel); border: 2px solid var(--stroke-2);
    border-radius: 14px; padding: 12px 14px; margin-bottom: 6px;
    overflow: hidden;
  }
  .date-time-field .cal-icon { flex-shrink: 0; color: var(--dim); }
  .date-time-field .dt-display {
    font-family: var(--body); font-size: 15px; font-weight: 600; color: var(--hi);
  }
  /* The actual <input> -- fills the whole field and sits on top, but
     invisible, so every tap anywhere in the box lands on it and opens the
     native date+time picker; .dt-display above is purely decorative. */
  .date-time-field .dt-native {
    position: absolute; inset: 0;
    width: 100%; height: 100%;
    opacity: 0;
    border: none; background: none; padding: 0; margin: 0;
  }
</style>
