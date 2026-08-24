import React from 'react';

export function SettingsRow({ title, description, showsDivider = true, children }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-8)',
        padding: 'var(--pad-row-y) var(--pad-row-x)', minHeight: 'var(--form-row-height)' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-row-title)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-row-title)' }}>{title}</span>
          {description ? (
            <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-subheadline)', color: 'var(--text-row-description)', textWrap: 'pretty' }}>{description}</span>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>{children}</div>
      </div>
      {showsDivider ? <div style={{ height: '1px', background: 'var(--border-card)', marginLeft: 'var(--pad-row-x)' }} /> : null}
    </div>
  );
}
