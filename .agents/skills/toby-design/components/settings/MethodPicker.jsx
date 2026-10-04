import React from 'react';

// "Sign in › Method": a segmented control over an integration's auth
// methods. "(recommended)" is dropped from labels; the default method is
// the recommended one.
export function methodName(label) {
  return String(label).replace(/\(recommended\)/i, '').trim();
}

export function MethodPicker({ options = [], value, onChange, label = 'Method' }) {
  const segment = (on) => ({ border: 'none', borderRadius: 'var(--radius-control)', padding: '3px 14px', cursor: 'pointer',
    fontFamily: 'var(--font-system)', fontSize: 'var(--size-callout)', fontWeight: 'var(--weight-medium)',
    color: on ? 'var(--text-row-title)' : 'var(--text-row-description)',
    background: on ? 'var(--surface-card)' : 'transparent', boxShadow: on ? '0 1px 2px rgba(0,0,0,.14)' : 'none' });
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', minHeight: '44px', padding: '0 14px',
      fontFamily: 'var(--font-system)' }}>
      <span style={{ fontSize: 'var(--size-body)', color: 'var(--text-row-title)' }}>{label}</span>
      <div role="radiogroup" aria-label={label} style={{ display: 'flex', padding: '2px', gap: '2px', borderRadius: '8px',
        background: 'color-mix(in srgb, var(--toby-text-primary) 7%, transparent)' }}>
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={o.value === value}
            onClick={onChange ? () => onChange(o.value) : undefined} style={segment(o.value === value)}>
            {methodName(o.label)}
          </button>
        ))}
      </div>
    </div>
  );
}
