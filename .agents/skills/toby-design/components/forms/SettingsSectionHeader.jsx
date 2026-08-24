import React from 'react';

export function SettingsSectionHeader({ children }) {
  return (
    <div style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-subheadline)', fontWeight: 'var(--weight-medium)',
      color: 'var(--text-section-header)', paddingLeft: 'var(--space-2)', paddingBottom: 'var(--space-3)' }}>{children}</div>
  );
}
