import React from 'react';

export function SidebarSection({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: 'var(--space-6)' }}>
      {title ? (
        <div style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-semibold)',
          color: 'var(--text-faint)', letterSpacing: '.06em', textTransform: 'uppercase', padding: '0 8px 4px' }}>{title}</div>
      ) : null}
      {children}
    </div>
  );
}
