import React from 'react';

export function InputDock({ value = '', placeholder = 'Return to send · Shift+Return for newline', contextPercent, attachments, loading = false, onChange, onSubmit }) {
  const canSubmit = !loading && (value.trim().length > 0);
  return (
    <div style={{ background: 'var(--surface-content)', border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-dock)', display: 'flex', flexDirection: 'column' }}>
      {attachments ? <div style={{ display: 'flex', gap: 'var(--space-3)', padding: '10px 12px 0', overflow: 'hidden' }}>{attachments}</div> : null}
      <textarea rows="2" value={value} placeholder={placeholder} disabled={loading}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        style={{ resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-body)',
          fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', lineHeight: 1.45,
          padding: '12px var(--pad-dock-x) 8px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '0 12px 10px' }}>
        <button type="button" aria-label="Add files" style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-pill)',
          border: 'none', background: 'var(--surface-selected)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '15px' }}>+</button>
        <span style={{ flex: 1 }} />
        {typeof contextPercent === 'number' ? (
          <span title={'Context window: ' + contextPercent + '% full'} aria-label="Context window"
            style={{ width: '16px', height: '16px', borderRadius: 'var(--radius-pill)', flexShrink: 0,
              background: 'conic-gradient(' + (contextPercent >= 80 ? 'var(--toby-accent-orange)' : 'var(--text-muted)') + ' ' + contextPercent + '%, color-mix(in srgb, var(--text-faint) 38%, transparent) 0)',
              mask: 'radial-gradient(circle, transparent 4px, #000 5px)', WebkitMask: 'radial-gradient(circle, transparent 4px, #000 5px)' }} />
        ) : null}
        <button type="button" aria-label="Send" disabled={!canSubmit} onClick={onSubmit}
          style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-pill)', border: 'none', cursor: canSubmit ? 'pointer' : 'default',
            background: canSubmit ? 'var(--toby-accent)' : 'var(--surface-selected)',
            color: canSubmit ? 'var(--surface-content)' : 'var(--text-faint)', fontSize: '15px' }}>↑</button>
      </div>
    </div>
  );
}
