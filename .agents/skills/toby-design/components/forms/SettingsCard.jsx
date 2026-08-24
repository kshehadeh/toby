import React from 'react';

export function SettingsCard({ children }) {
  return (
    <div style={{ background: 'var(--surface-card)', borderRadius: 'var(--radius-card)',
      border: '1px solid var(--border-card)', overflow: 'hidden', maxWidth: 'var(--settings-content-max)' }}>{children}</div>
  );
}
