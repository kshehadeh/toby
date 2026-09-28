import React from 'react';
import { ChevronUpDown } from '../glyphs.jsx';

// SidebarFooter: the persona button (24px portrait with 4px corners, 13px name, trailing
// chevron.up.chevron.down) on 6/8 padding with 9px corners and no resting
// fill, then the server status dot. Open, the button takes a 14% accent
// fill; asking for attention, a 16% accent fill and a 1.5px accent stroke.
export function PersonaFooter({ name = 'Toby', imageSrc, status = 'connected', open = false, attention = false, onClick }) {
  const statusColor = { connected: 'var(--system-green)', connecting: 'var(--toby-accent)', error: 'var(--system-red)', idle: 'var(--text-faint)' }[status] || 'var(--text-faint)';
  const fill = open ? 'color-mix(in srgb, var(--toby-accent) 14%, transparent)' : attention ? 'color-mix(in srgb, var(--toby-accent) 16%, transparent)' : 'transparent';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <button type="button" onClick={onClick} className={attention ? 'toby-pulse' : undefined}
        style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '8px', textAlign: 'left',
          padding: '6px 8px', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: fill,
          boxShadow: attention ? 'inset 0 0 0 1.5px color-mix(in srgb, var(--toby-accent) 75%, transparent)' : 'none' }}>
        {imageSrc ? (
          <img src={imageSrc} alt="" width="24" height="24" style={{ width: '24px', height: '24px', borderRadius: '4px', objectFit: 'cover', flexShrink: 0, background: '#fff' }} />
        ) : (
          <span style={{ width: '24px', height: '24px', borderRadius: '4px', background: 'var(--surface-panel)', flexShrink: 0 }} />
        )}
        <span style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', color: 'var(--text-body)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        <span aria-hidden="true" style={{ color: 'var(--text-faint)', display: 'inline-flex' }}><ChevronUpDown size={10} stroke={2.6} /></span>
      </button>
      <span role="img" aria-label={'Server ' + status} title={'Server ' + status}
        style={{ width: '8px', height: '8px', margin: '0 6px', borderRadius: 'var(--radius-pill)', background: statusColor, flexShrink: 0 }} />
    </div>
  );
}
