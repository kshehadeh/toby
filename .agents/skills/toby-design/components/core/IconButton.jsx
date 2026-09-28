import React from 'react';

const iconButtonSizes = { sm: 22, md: 28, lg: 34 };

// Circular glyph-only control (`.buttonBorderShape(.circle)`). `muted` is the
// grey bordered circle, `prominent` the accent-filled circle with a white
// glyph (Send), `accent` an accent wash, `faint` a quiet grey glyph.
export function IconButton({ glyph, label, tone = 'muted', size = 'md', disabled = false, filled = true, onClick, ...rest }) {
  const px = iconButtonSizes[size] || iconButtonSizes.md;
  const t = tone === 'inverted' ? 'prominent' : tone;
  const tones = {
    muted: { background: filled ? 'var(--surface-selected)' : 'transparent', color: 'var(--text-body)' },
    faint: { background: filled ? 'var(--surface-selected)' : 'transparent', color: 'var(--text-faint)' },
    accent: { background: filled ? 'var(--accent-wash)' : 'transparent', color: 'var(--text-accent)' },
    prominent: { background: disabled ? 'color-mix(in srgb, var(--text-body) 14%, transparent)' : 'var(--toby-accent)', color: '#fff' }
  };
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      style={{ width: px + 'px', height: px + 'px', borderRadius: 'var(--radius-pill)', border: 'none', padding: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled && t !== 'prominent' ? 0.45 : 1, transition: 'background var(--dur-hover) var(--ease-out)', ...(tones[t] || tones.muted) }} {...rest}>
      <span aria-hidden="true" style={{ display: 'inline-flex', width: Math.round(px * 0.5) + 'px', height: Math.round(px * 0.5) + 'px', alignItems: 'center', justifyContent: 'center' }}>{glyph}</span>
    </button>
  );
}
