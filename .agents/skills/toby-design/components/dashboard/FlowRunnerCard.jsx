import React from 'react';

export function FlowRunnerCard({ title, description, stamp, running = false, error, onRun }) {
  return (
    <div style={{ width: 156, display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-caption, 11px)',
        color: 'var(--text-faint)', padding: '2px 8px 0' }}>Actions</div>
      <button type="button" onClick={onRun} disabled={running} aria-label={title}
        title={description}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%',
          padding: '8px', border: 'none', borderRadius: 'var(--radius-sm)',
          background: running ? 'color-mix(in srgb, var(--toby-accent) 12%, transparent)' : 'transparent',
          color: 'var(--text-body)', fontFamily: 'var(--font-system)',
          fontSize: 'var(--size-callout, 12px)', fontWeight: 500, cursor: running ? 'default' : 'pointer',
          opacity: running ? 0.85 : 1, textAlign: 'left' }}>
        <span aria-hidden="true" style={{ width: 16, height: 16, display: 'inline-flex',
          color: 'var(--toby-accent)', flex: '0 0 16px' }}>
          {running ? '…' : (stamp ?? '▶')}
        </span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
      </button>
      {error ? (
        <div style={{ padding: '0 8px', fontFamily: 'var(--font-system)', fontSize: 10, color: 'var(--status-danger)' }}>{error}</div>
      ) : null}
    </div>
  );
}
