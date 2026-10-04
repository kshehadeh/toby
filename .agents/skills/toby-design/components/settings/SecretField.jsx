import React from 'react';
import { CheckCircle } from '../glyphs.jsx';

const smallButton = { height: '22px', padding: '0 10px', borderRadius: 'var(--radius-pill)', border: 'none',
  background: 'color-mix(in srgb, var(--toby-text-primary) 8%, transparent)', fontFamily: 'var(--font-system)',
  fontSize: 'var(--size-callout)', color: 'var(--text-row-title)', cursor: 'pointer' };

// SettingsSecretFieldRow (UI/SettingsControls): a saved secret reads
// "✓ Saved" with Change…; Change… opens an empty secure field with Done.
// Unsaved, it is a plain right-aligned secure field with a placeholder.
export function SecretField({ label, saved = false, placeholder = '', value = '', onChange }) {
  const [editing, setEditing] = React.useState(false);
  const row = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
    minHeight: '40px', padding: '0 14px', fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)' };
  const field = (wide) => (
    <input type="password" aria-label={label} value={value} placeholder={wide ? 'Paste a new value' : placeholder}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      style={wide
        ? { width: '230px', height: '24px', boxSizing: 'border-box', padding: '0 8px', borderRadius: 'var(--radius-control)',
          border: '1px solid var(--border-control)', background: 'var(--surface-card)', fontFamily: 'var(--font-system)',
          fontSize: 'var(--size-body)', color: 'var(--text-row-title)' }
        : { flex: 1, minWidth: 0, border: 'none', background: 'transparent', textAlign: 'right', outline: 'none',
          fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', color: 'var(--text-row-title)' }} />
  );
  return (
    <div style={row}>
      <span style={{ color: 'var(--text-row-title)', flexShrink: 0 }}>{label}</span>
      {saved && !editing ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-row-description)' }}>
            <span style={{ color: 'var(--status-complete)', display: 'inline-flex' }}><CheckCircle size={13} /></span>Saved
          </span>
          <button type="button" style={smallButton} aria-label={`Change ${label}`} onClick={() => setEditing(true)}>Change…</button>
        </span>
      ) : saved ? (
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {field(true)}
          <button type="button" style={smallButton} onClick={() => setEditing(false)}>Done</button>
        </span>
      ) : field(false)}
    </div>
  );
}
