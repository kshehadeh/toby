import React from 'react';

export function FlowRunnerCard({ title, description, stamp, running = false, error, onRun }) {
  return (
    <div style={{ position: 'relative', background: 'var(--surface-panel)', borderRadius: 'var(--radius-lg)',
      padding: '26px', overflow: 'hidden', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <span style={{ position: 'absolute', left: '26px', right: '26px', top: 0, height: '2px', background: 'var(--toby-accent)', opacity: 0.85 }} />
      {stamp ? <span aria-hidden="true" style={{ position: 'absolute', right: '-10px', bottom: '-14px', color: 'var(--text-body)', opacity: 0.045, pointerEvents: 'none', display: 'inline-flex' }}>{stamp}</span> : null}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-5)', marginBottom: 'var(--space-9)' }}>
        <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-card-title)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-body)' }}>{title}</span>
      </div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: '14px', lineHeight: 1.6, color: 'var(--text-muted)', textWrap: 'pretty' }}>{description}</div>
      {error ? (
        <div style={{ marginTop: 'var(--space-4)', fontFamily: 'var(--font-system)', fontSize: 'var(--size-callout)', color: 'var(--status-danger)' }}>{error}</div>
      ) : null}
      <div style={{ flex: 1, minHeight: 'var(--space-8)' }} />
      <button type="button" onClick={onRun} disabled={running}
        style={{ width: '100%', height: '30px', borderRadius: 'var(--radius-control)', border: '1px solid transparent',
          background: 'var(--toby-accent)', color: 'var(--text-on-accent)', fontFamily: 'var(--font-system)',
          fontSize: 'var(--size-body)', fontWeight: 'var(--weight-semibold)', cursor: running ? 'default' : 'pointer',
          opacity: running ? 0.5 : 1, transition: 'opacity var(--dur-hover) var(--ease-out)' }}>
        {running ? 'Running…' : 'Run Now'}
      </button>
    </div>
  );
}
