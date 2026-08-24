import React from 'react';

export function WorkStepRow({ title, body, duration, count, glyph, active = false, expandable = false, expanded = false, onToggle }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <button type="button" onClick={expandable ? onToggle : undefined}
        style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-5)', border: 'none', background: 'transparent',
          padding: '6px 0', textAlign: 'left', cursor: expandable ? 'pointer' : 'default', width: '100%' }}>
        <span aria-hidden="true" style={{ width: '16px', height: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'var(--text-accent)' }}>
          {glyph || <span style={{ width: active ? '9px' : '7px', height: active ? '9px' : '7px', borderRadius: 'var(--radius-pill)', background: 'var(--toby-accent)', opacity: active ? 0.6 : 1 }} />}
        </span>
        <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-4)' }}>
            <span style={{ fontFamily: 'var(--font-rounded)', fontSize: 'var(--size-step-meta)', fontWeight: 'var(--weight-semibold)',
              letterSpacing: 'var(--tracking-step-meta)', textTransform: 'uppercase', color: 'var(--text-muted)' }}>{title}</span>
            <span style={{ flex: 1 }} />
            {count > 1 ? <span style={{ fontFamily: 'var(--font-rounded)', fontSize: 'var(--size-step-meta)', color: 'var(--text-faint)' }}>{'×' + count}</span> : null}
            {duration ? <span style={{ fontFamily: 'var(--font-rounded)', fontSize: 'var(--size-step-meta)', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{duration}</span> : null}
            {expandable ? <span aria-hidden="true" style={{ fontSize: '9px', color: 'var(--text-faint)', transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-expand) var(--ease-out)' }}>▶</span> : null}
          </span>
          {!expanded && body ? <span style={{ fontFamily: 'var(--font-rounded)', fontSize: 'var(--size-step-meta)', color: 'var(--text-faint)', lineHeight: 1.45 }}>{body}</span> : null}
        </span>
      </button>
      {expanded && body ? (
        <div style={{ paddingLeft: '26px', paddingBottom: '6px', fontFamily: 'var(--font-rounded)',
          fontSize: 'var(--size-step-meta)', color: 'var(--text-faint)', whiteSpace: 'pre-wrap' }}>{body}</div>
      ) : null}
    </div>
  );
}
