import React from 'react';
import { ArrowUp, Plus, Stop, SlashCircle } from '../glyphs.jsx';

function CircleButton({ label, prominent = false, disabled = false, onClick, children }) {
  const [hover, setHover] = React.useState(false);
  const bg = prominent
    ? (disabled ? 'color-mix(in srgb, var(--text-body) 14%, transparent)' : 'var(--toby-accent)')
    : 'var(--surface-selected)';
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ position: 'relative', width: '28px', height: '28px', borderRadius: 'var(--radius-pill)', border: 'none', padding: 0,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: disabled ? 'default' : 'pointer',
        background: bg, color: prominent ? '#fff' : 'var(--text-body)', opacity: disabled && !prominent ? 0.45 : 1 }}>
      {children}
      {hover && !disabled ? <span style={{ position: 'absolute', inset: 0, borderRadius: 'var(--radius-pill)',
        background: 'color-mix(in srgb, var(--text-body) ' + (prominent ? 16 : 10) + '%, transparent)' }} /> : null}
    </button>
  );
}

// InputDock: one Liquid Glass slab (16px concentric corners). The text field
// is plain 13px body text whose placeholder is the key hint; the control row
// holds a bordered circular attach button on the leading edge and, trailing,
// the context gauge, a stop button while loading, and the accent send button.
export function InputDock({ value = '', placeholder = 'Return to send · Shift+Return for newline', contextPercent, contextUnavailable = false,
  attachments, loading = false, canAttach = true, onChange, onSubmit, onCancel, onAttach }) {
  const canSubmit = !loading && value.trim().length > 0;
  return (
    <div className="toby-glass" style={{ borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column' }}>
      {attachments ? <div style={{ display: 'flex', gap: '6px', padding: '10px 12px 0', overflow: 'hidden' }}>{attachments}</div> : null}
      <textarea rows="2" value={value} placeholder={placeholder} disabled={loading}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        style={{ resize: 'none', border: 'none', outline: 'none', background: 'transparent', color: 'var(--text-body)',
          fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', lineHeight: 1.4, padding: '12px var(--pad-dock-x) 8px' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', padding: '0 12px 10px' }}>
        <CircleButton label="Add files" disabled={loading || !canAttach} onClick={onAttach}><Plus size={14} stroke={2.4} /></CircleButton>
        <span style={{ flex: 1 }} />
        {typeof contextPercent === 'number' ? (
          <span title={'Context window: ' + contextPercent + '% full'} aria-label={'Context window ' + contextPercent + '% full'}
            style={{ width: '14px', height: '14px', borderRadius: 'var(--radius-pill)', flexShrink: 0,
              background: 'conic-gradient(' + (contextPercent >= 80 ? 'var(--toby-accent)' : 'var(--text-muted)') + ' ' + contextPercent + '%, color-mix(in srgb, var(--text-faint) 38%, transparent) 0)',
              mask: 'radial-gradient(circle, transparent 4px, #000 5px)', WebkitMask: 'radial-gradient(circle, transparent 4px, #000 5px)' }} />
        ) : contextUnavailable ? (
          <span title="Provider doesn't support context window information." style={{ color: 'var(--text-faint)', display: 'inline-flex', padding: '4px' }}><SlashCircle size={14} /></span>
        ) : null}
        {loading ? <CircleButton label="Cancel" onClick={onCancel}><Stop size={12} /></CircleButton> : null}
        <CircleButton label="Send" prominent disabled={!canSubmit} onClick={onSubmit}><ArrowUp size={14} stroke={2.6} /></CircleButton>
      </div>
    </div>
  );
}
