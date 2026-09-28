import React from 'react';
import { ChevronUpDown } from '../glyphs.jsx';

// SettingsSelectChoiceField: a menu-style pop-up button. On macOS 26 that is a
// grey capsule with the value on the leading side and chevron.up.chevron.down
// trailing.
export function Select({ value, options = [], minWidth = 120, maxWidth = 320, onChange, ...rest }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', minWidth: minWidth + 'px', maxWidth: maxWidth + 'px' }}>
      <select value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        style={{ appearance: 'none', WebkitAppearance: 'none', width: '100%', fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)',
          color: 'var(--text-body)', background: 'var(--surface-selected)', border: 'none', borderRadius: 'var(--radius-pill)',
          height: 'var(--form-control-height)', padding: '0 26px 0 10px', cursor: 'pointer', outline: 'none' }} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <span aria-hidden="true" style={{ position: 'absolute', right: '9px', pointerEvents: 'none', color: 'var(--text-muted)', display: 'inline-flex' }}>
        <ChevronUpDown size={10} stroke={2.6} />
      </span>
    </span>
  );
}
