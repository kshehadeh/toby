import React from 'react';

export function InlineStatusMessage({ tone = 'success', message, glyph }) {
  const tones = {
    success: { background: 'var(--status-success-bg)', border: 'var(--status-success-border)', color: 'var(--status-success-fg)', mark: '✓' },
    error: { background: 'var(--status-error-bg)', border: 'var(--status-error-border)', color: 'var(--status-error-fg)', mark: '!' }
  };
  const t = tones[tone] || tones.success;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', padding: '10px 12px',
      background: t.background, border: '1px solid ' + t.border, borderRadius: 'var(--radius-control)', color: t.color,
      fontFamily: 'var(--font-system)', fontSize: 'var(--size-subheadline)', lineHeight: 1.45 }}>
      <span aria-hidden="true" style={{ width: '14px', textAlign: 'center', fontWeight: 'var(--weight-semibold)', flexShrink: 0 }}>{glyph || t.mark}</span>
      <span style={{ textWrap: 'pretty' }}>{message}</span>
    </div>
  );
}
