import React from 'react';

export function TextField({ value = '', placeholder = '', secure = false, minWidth = 120, maxWidth = 220, onChange, ...rest }) {
  return (
    <input type={secure ? 'password' : 'text'} value={value} placeholder={placeholder}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', color: 'var(--text-body)',
        background: 'var(--surface-content)', border: '1px solid var(--border-control)', borderRadius: 'var(--radius-control)',
        height: 'var(--form-control-height)', padding: '0 8px', minWidth: minWidth + 'px', maxWidth: maxWidth + 'px', outline: 'none' }} {...rest} />
  );
}
