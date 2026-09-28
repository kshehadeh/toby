import React from 'react';

// Sidebar section ("Automation", "Tools"): a 10px caption in tertiary text,
// sentence case, 8px from the leading edge and 10px above, 4px over its rows.
export function SidebarSection({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {title ? (
        <div style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-medium)',
          color: 'var(--text-faint)', padding: '10px 8px 0' }}>{title}</div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>{children}</div>
    </div>
  );
}
