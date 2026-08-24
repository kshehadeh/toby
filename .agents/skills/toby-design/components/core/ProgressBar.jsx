import React from 'react';

export function ProgressBar({ progress = 0, height = 3 }) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}
      style={{ width: '100%', height: height + 'px', borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--text-body) 10%, transparent)', overflow: 'hidden' }}>
      <div style={{ width: pct + '%', height: '100%', borderRadius: 'var(--radius-pill)', background: 'var(--toby-accent)',
        transition: 'width var(--dur-section) var(--ease-out)' }} />
    </div>
  );
}
