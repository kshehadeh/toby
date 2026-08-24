import React from 'react';

const iconButtonSizes = { sm: 22, md: 26, lg: 34 };

export function IconButton({ glyph, label, tone = 'muted', size = 'md', disabled = false, filled = true, onClick, ...rest }) {
  const px = iconButtonSizes[size] || iconButtonSizes.md;
  const tones = {
    muted: { background: filled ? 'var(--surface-selected)' : 'transparent', color: 'var(--text-muted)' },
    faint: { background: filled ? 'var(--surface-selected)' : 'transparent', color: 'var(--text-faint)' },
    accent: { background: filled ? 'var(--accent-wash)' : 'transparent', color: 'var(--text-accent)' },
    inverted: { background: 'var(--text-body)', color: 'var(--surface-content)' }
  };
  const t = tones[tone] || tones.muted;
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      style={{ width: px + 'px', height: px + 'px', borderRadius: 'var(--radius-pill)', border: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1, transition: 'background var(--dur-hover) var(--ease-out)', ...t }} {...rest}>
      <span aria-hidden="true" style={{ display: 'inline-flex', width: Math.round(px * 0.54) + 'px', height: Math.round(px * 0.54) + 'px' }}>{glyph}</span>
    </button>
  );
}
