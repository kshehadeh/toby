import React from 'react';

function GridButton({ item, selected, onSelect }) {
  const [hover, setHover] = React.useState(false);
  const tint = item.color || 'var(--toby-accent)';
  const bg = selected ? 'color-mix(in srgb,' + tint + ' 22%, transparent)' : hover ? 'color-mix(in srgb,' + tint + ' 18%, transparent)' : 'transparent';
  const fg = (selected || hover) ? tint : 'var(--text-muted)';
  return (
    <button type="button" title={item.title} aria-label={item.title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={onSelect ? () => onSelect(item.id) : undefined}
      style={{ minHeight: '34px', border: 'none', borderRadius: 'var(--radius-sm)', background: bg, color: fg,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        transition: 'background var(--dur-hover) var(--ease-out), color var(--dur-hover) var(--ease-out)' }}>
      <span aria-hidden="true" style={{ width: '18px', height: '18px', display: 'inline-flex' }}>{item.glyph}</span>
    </button>
  );
}

export function SidebarActionGrid({ items = [], selectedId, onSelect }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--gap-grid)', padding: '6px 0 8px' }}>
      {items.map((item) => (
        <GridButton key={item.id} item={item} selected={item.id === selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}
