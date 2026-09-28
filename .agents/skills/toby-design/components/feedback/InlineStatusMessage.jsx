import React from 'react';
import { CheckCircle, Warning } from '../glyphs.jsx';

// InlineStatusMessage: a filled + outlined strip, 6px corners, 10/12 padding,
// 11px text in the tone's foreground with a semibold 14px-wide glyph
// (checkmark.circle.fill / exclamationmark.triangle.fill).
export function InlineStatusMessage({ tone = 'success', message, glyph }) {
  const tones = {
    success: { background: 'var(--status-success-bg)', border: 'var(--status-success-border)', color: 'var(--status-success-fg)', mark: <CheckCircle size={12} /> },
    error: { background: 'var(--status-error-bg)', border: 'var(--status-error-border)', color: 'var(--status-error-fg)', mark: <Warning size={12} /> }
  };
  const t = tones[tone] || tones.success;
  return (
    <div role="status" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', padding: '10px 12px',
      background: t.background, border: '1px solid ' + t.border, borderRadius: 'var(--radius-control)', color: t.color,
      fontFamily: 'var(--font-system)', fontSize: 'var(--size-subheadline)', lineHeight: 1.45 }}>
      <span aria-hidden="true" style={{ width: '14px', display: 'inline-flex', justifyContent: 'center', paddingTop: '1px', flexShrink: 0 }}>{glyph || t.mark}</span>
      <span style={{ textWrap: 'pretty' }}>{message}</span>
    </div>
  );
}
