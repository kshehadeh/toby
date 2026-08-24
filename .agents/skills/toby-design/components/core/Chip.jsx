import React from 'react';

export function Chip({ leading, label, meta, onRemove }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'var(--surface-selected)',
      borderRadius: 'var(--radius-pill)', padding: 'var(--pad-chip-y) var(--pad-chip-x)',
      fontFamily: 'var(--font-system)', fontSize: 'var(--size-callout)', color: 'var(--text-muted)', maxWidth: '260px' }}>
      {leading ? <span aria-hidden="true" style={{ display: 'inline-flex', width: '12px', height: '12px', color: 'var(--text-accent)' }}>{leading}</span> : null}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      {meta ? <span style={{ color: 'var(--text-faint)' }}>{meta}</span> : null}
      {onRemove ? (
        <button type="button" aria-label={'Remove ' + label} onClick={onRemove}
          style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
            width: '16px', height: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', fontWeight: 700 }}>✕</button>
      ) : null}
    </span>
  );
}
