import React from 'react';
import { CheckCircle, ErrorCircle, XMark } from '../glyphs.jsx';

// ToastView: an interactive Liquid Glass slab (16px concentric corners,
// 12/14 padding, max 420px). A 24px system-green or system-red glyph (a
// spinner for progress), an 11px semibold title, a 10px secondary message
// (4 lines max), an optional accent action, and a tertiary ✕.
export function Toast({ style = 'success', title, message, actionLabel, onAction, onDismiss }) {
  const marks = {
    success: <span style={{ color: 'var(--system-green)', display: 'inline-flex' }}><CheckCircle size={18} /></span>,
    error: <span style={{ color: 'var(--system-red)', display: 'inline-flex' }}><ErrorCircle size={18} /></span>,
    progress: <span className="toby-spinner" style={{ color: 'var(--toby-accent)' }} />
  };
  return (
    <div className="toby-glass" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-6)', maxWidth: 'var(--toast-max)',
      padding: '12px 14px', borderRadius: 'var(--radius-lg)', fontFamily: 'var(--font-system)', boxSizing: 'border-box' }}>
      <span aria-hidden="true" style={{ width: '24px', height: '24px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{marks[style] || marks.success}</span>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontSize: 'var(--size-subheadline)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-body)' }}>{title}</span>
        {message ? <span style={{ fontSize: 'var(--size-caption)', color: 'var(--text-muted)', lineHeight: 1.45, textWrap: 'pretty' }}>{message}</span> : null}
        {actionLabel ? (
          <button type="button" onClick={onAction} style={{ alignSelf: 'flex-start', border: 'none', background: 'transparent',
            color: 'var(--text-accent)', fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-semibold)', cursor: 'pointer', padding: 0 }}>{actionLabel}</button>
        ) : null}
      </div>
      {style !== 'progress' ? (
        <button type="button" aria-label="Dismiss" title="Dismiss" onClick={onDismiss} style={{ border: 'none', background: 'transparent', padding: 0,
          color: 'var(--text-faint)', cursor: 'pointer', width: '22px', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><XMark size={10} stroke={3} /></button>
      ) : null}
    </div>
  );
}
