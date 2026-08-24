import React from 'react';

export function PersonaFooter({ name = 'Toby', model = '', imageSrc, open = false, onClick }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', width: '100%', textAlign: 'left',
        padding: 'var(--space-4)', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        background: open || hover ? 'var(--surface-selected)' : 'transparent',
        transition: 'background var(--dur-hover) var(--ease-out)' }}>
      {imageSrc ? (
        <img src={imageSrc} alt="" width="32" height="32" style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-pill)', objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <span style={{ width: '32px', height: '32px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-elevated)', flexShrink: 0 }} />
      )}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-callout)', color: 'var(--text-body)' }}>{name}</span>
        <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-caption)', color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model}</span>
      </span>
      <span aria-hidden="true" style={{ color: 'var(--text-faint)', fontSize: '9px', lineHeight: 1.1, textAlign: 'center' }}>▲<br />▼</span>
    </button>
  );
}
