import React from 'react';

export function Toggle({ checked = false, disabled = false, label = '', onChange }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label || undefined} disabled={disabled}
      onClick={onChange ? () => onChange(!checked) : undefined}
      style={{ width: '38px', height: '22px', borderRadius: 'var(--radius-pill)', border: 'none', padding: '2px',
        background: checked ? 'var(--control-toggle-on)' : 'color-mix(in srgb, var(--text-faint) 35%, transparent)',
        opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer', display: 'inline-flex',
        justifyContent: checked ? 'flex-end' : 'flex-start', alignItems: 'center',
        transition: 'background var(--dur-hover) var(--ease-out)' }}>
      <span style={{ width: '18px', height: '18px', borderRadius: 'var(--radius-pill)', background: '#fff',
        boxShadow: '0 1px 2px rgba(0,0,0,.25)', display: 'block' }} />
    </button>
  );
}
