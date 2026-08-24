import React from 'react';

export function Skeleton({ lines = 4, height = 12 }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }} aria-hidden="true">
      <style>{'@keyframes tobySkeletonPulse{0%{opacity:.9}100%{opacity:.5}}'}</style>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} style={{ height: height + 'px', borderRadius: 'var(--radius-skeleton)', background: 'var(--surface-elevated)',
          animation: 'tobySkeletonPulse var(--dur-skeleton) var(--ease-in-out) infinite alternate' }} />
      ))}
    </div>
  );
}
