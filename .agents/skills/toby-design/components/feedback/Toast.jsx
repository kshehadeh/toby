import React from 'react';

export function Toast({ style = 'success', title, message, actionLabel, onAction, onDismiss }) {
  const marks = { success: { glyph: '✓', color: 'var(--control-toggle-on)' }, error: { glyph: '✕', color: 'var(--status-danger)' }, progress: { glyph: '◌', color: 'var(--text-accent)' } };
  const m = marks[style] || marks.success;
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-6)', maxWidth: 'var(--toast-max)',
      padding: '12px 14px', borderRadius: 'var(--radius-lg)', background: 'var(--surface-elevated)',
      backdropFilter: 'var(--blur-material)', border: '1px solid var(--border-hairline)', boxShadow: 'var(--shadow-toast)',
      fontFamily: 'var(--font-system)' }}>
      <span aria-hidden="true" style={{ width: '24px', height: '24px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: m.color, fontSize: '15px', fontWeight: 700 }}>{m.glyph}</span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--size-subheadline)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-body)' }}>{title}</span>
        {message ? <span style={{ fontSize: 'var(--size-caption)', color: 'var(--text-muted)', lineHeight: 1.45, textWrap: 'pretty' }}>{message}</span> : null}
        {actionLabel ? (
          <button type="button" onClick={onAction} style={{ alignSelf: 'flex-start', border: 'none', background: 'transparent',
            color: 'var(--text-accent)', fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-semibold)', cursor: 'pointer', padding: 0, marginTop: '2px' }}>{actionLabel}</button>
        ) : null}
      </div>
      {style !== 'progress' ? (
        <button type="button" aria-label="Dismiss" onClick={onDismiss} style={{ border: 'none', background: 'transparent',
          color: 'var(--text-faint)', cursor: 'pointer', width: '22px', height: '22px', fontSize: '10px', fontWeight: 700 }}>✕</button>
      ) : null}
    </div>
  );
}
