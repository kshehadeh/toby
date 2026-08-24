import React from 'react';

export function Select({ value, options = [], minWidth = 120, maxWidth = 320, onChange, ...rest }) {
  return (
    <select value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', color: 'var(--text-body)',
        background: 'var(--surface-card)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-control)',
        height: 'var(--form-control-height)', padding: '0 6px', minWidth: minWidth + 'px', maxWidth: maxWidth + 'px' }} {...rest}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
