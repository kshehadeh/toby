import React from 'react';

export function AssistantMessage({ header = 'Toby', avatarSrc, children, footer }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-5)' }}>
      <div style={{ width: '28px', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
        {avatarSrc ? (
          <img src={avatarSrc} alt="" width="28" height="28" style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-pill)', objectFit: 'cover' }} />
        ) : (
          <span style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-elevated)' }} />
        )}
        <span style={{ flex: 1, width: '1px', background: 'var(--border-hairline)', minHeight: '12px' }} />
      </div>
      <div style={{ maxWidth: 'var(--transcript-assistant-max)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <span style={{ fontFamily: 'var(--font-rounded)', fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-muted)' }}>{header}</span>
        <div style={{ fontFamily: 'var(--font-serif)', fontSize: 'var(--size-answer)', color: 'var(--text-body)',
          lineHeight: 'var(--leading-answer)', textWrap: 'pretty' }}>{children}</div>
        {footer ? <div style={{ paddingTop: '2px' }}>{footer}</div> : null}
      </div>
    </div>
  );
}
