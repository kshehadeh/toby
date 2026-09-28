import React from 'react';

// Two row shapes share this component.
// variant="browser" (default) is FeatureBrowserRow, the row of every
// list/detail column: 20px glyph box (tertiary, accent when selected), a
// 12px medium title (secondary, primary when selected), an optional 9px
// semibold badge capsule, a 10px tertiary subtitle, 8/10 padding, 8px
// corners, selection fill only.
// variant="destination" is a primary sidebar destination (a native List
// Label): 16px glyph and 13px title in primary text, a grey rounded
// selection fill, no subtitle.
export function SidebarRow({ variant = 'browser', title, subtitle, badge, glyph, selected = false, drawsSelectionFill = true, trailing, onClick }) {
  const [hover, setHover] = React.useState(false);
  if (variant === 'destination') {
    return (
      <button type="button" onClick={onClick} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        aria-current={selected ? 'page' : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', padding: '6px 10px',
          border: 'none', borderRadius: 'var(--radius-row)', cursor: 'pointer',
          background: selected ? 'var(--surface-selected-strong)' : hover ? 'var(--surface-hover)' : 'transparent' }}>
        {glyph ? <span aria-hidden="true" style={{ width: '18px', height: '16px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-body)', flexShrink: 0 }}>{glyph}</span> : null}
        <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {trailing ? <span style={{ marginLeft: 'auto', color: 'var(--text-faint)', display: 'inline-flex' }}>{trailing}</span> : null}
      </button>
    );
  }
  const fill = drawsSelectionFill && selected ? 'var(--surface-selected)' : 'transparent';
  return (
    <button type="button" onClick={onClick} aria-current={selected ? 'true' : undefined}
      style={{ display: 'flex', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'left',
        padding: '8px 10px', border: 'none', background: fill, borderRadius: 'var(--radius-row)', cursor: 'pointer' }}>
      {glyph ? <span aria-hidden="true" style={{ width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: selected ? 'var(--toby-accent)' : 'var(--text-faint)', flexShrink: 0 }}>{glyph}</span> : null}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
          <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-callout)', fontWeight: 'var(--weight-medium)',
            color: selected ? 'var(--text-body)' : 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          {badge ? <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-badge)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-faint)',
            padding: '1px 5px', borderRadius: 'var(--radius-pill)', background: 'color-mix(in srgb, var(--text-body) 8%, transparent)', flexShrink: 0 }}>{badge}</span> : null}
        </span>
        {subtitle ? <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-caption)', color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</span> : null}
      </span>
      {trailing ? <span style={{ color: 'var(--text-muted)', display: 'inline-flex', flexShrink: 0 }}>{trailing}</span> : null}
    </button>
  );
}
