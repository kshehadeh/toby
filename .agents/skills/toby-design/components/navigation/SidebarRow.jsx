import React from 'react';

export function SidebarRow({ title, subtitle, glyph, selected = false, trailing, onClick }) {
  const [hover, setHover] = React.useState(false);
  const fill = selected ? 'var(--surface-selected)' : hover ? 'var(--surface-hover)' : 'transparent';
  const fg = selected ? 'var(--text-body)' : 'var(--text-muted)';
  return (
    <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', width: '100%', textAlign: 'left',
        padding: '7px 8px', border: 'none', background: fill, borderRadius: 'var(--radius-sm)', cursor: 'pointer',
        transition: 'background var(--dur-hover) var(--ease-out)' }}>
      {glyph ? <span aria-hidden="true" style={{ width: '16px', height: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: fg, flexShrink: 0 }}>{glyph}</span> : null}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1px' }}>
        <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-callout)', color: fg, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {subtitle ? <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-caption)', color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span> : null}
      </span>
      {trailing ? <span style={{ color: 'var(--text-muted)', display: 'inline-flex', flexShrink: 0 }}>{trailing}</span> : null}
    </button>
  );
}
