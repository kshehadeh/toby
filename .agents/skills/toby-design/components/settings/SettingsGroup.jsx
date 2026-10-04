import React from 'react';

// A System Settings section (Form `.grouped` Section): a 13px semibold title,
// rows on one rounded fill separated by inset hairlines, and an optional
// one-sentence footer under the box.
export const groupFill = 'color-mix(in srgb, var(--toby-text-primary) 3.5%, transparent)';

export function SettingsGroup({ title, footer, children }) {
  const rows = React.Children.toArray(children).filter(Boolean);
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontFamily: 'var(--font-system)' }}>
      {title ? (
        <div style={{ padding: '0 4px', fontSize: 'var(--size-headline)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-row-title)' }}>{title}</div>
      ) : null}
      <div style={{ borderRadius: 'var(--radius-tile)', background: groupFill, display: 'flex', flexDirection: 'column' }}>
        {rows.map((row, i) => (
          <React.Fragment key={i}>
            {i > 0 ? <div style={{ height: '1px', marginLeft: '14px', background: 'var(--border-hairline)' }} /> : null}
            {row}
          </React.Fragment>
        ))}
      </div>
      {footer ? (
        <div style={{ padding: '0 4px', fontSize: 'var(--size-callout)', lineHeight: 1.4, color: 'var(--text-row-description)' }}>{footer}</div>
      ) : null}
    </section>
  );
}

// One row: 13px label on the left, the control on the right, an optional
// one-sentence description under the label. 40px minimum height.
export function SettingsFormRow({ label, description, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
      minHeight: '40px', padding: description ? '8px 14px' : '0 14px', fontFamily: 'var(--font-system)' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
        <span style={{ fontSize: 'var(--size-body)', color: 'var(--text-row-title)' }}>{label}</span>
        {description ? <span style={{ fontSize: 'var(--size-callout)', color: 'var(--text-row-description)' }}>{description}</span> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>{children}</div>
    </div>
  );
}
