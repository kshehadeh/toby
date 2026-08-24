import React from 'react';

export function Badge({ tone = 'neutral', children }) {
  const tones = {
    neutral: { background: 'color-mix(in srgb, var(--text-faint) 12%, transparent)', color: 'var(--text-faint)', border: '1px solid color-mix(in srgb, var(--text-faint) 30%, transparent)' },
    accent: { background: 'var(--toby-accent)', color: 'var(--text-on-accent)', border: '1px solid transparent' },
    accentSoft: { background: 'var(--accent-wash-weak)', color: 'var(--text-accent)', border: '1px solid var(--accent-border-soft)' }
  };
  const t = tones[tone] || tones.neutral;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-system)', fontSize: 'var(--size-badge)', fontWeight: 'var(--weight-bold)',
      letterSpacing: '.04em', textTransform: 'uppercase', padding: '3px 7px', lineHeight: 1, ...t }}>{children}</span>
  );
}
