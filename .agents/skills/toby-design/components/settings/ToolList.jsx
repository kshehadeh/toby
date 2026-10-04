import React from 'react';
import { SettingsGroup } from './SettingsGroup.jsx';

// "What Toby can do in …": each tool with an icon for what it does, the
// first sentence of its description and a "Makes changes" tag on tools
// that write. Shows `collapsedCount` rows, then a "Show all" link.
export function ToolList({ integration, tools = [], collapsedCount = 3 }) {
  const [open, setOpen] = React.useState(false);
  const visible = open ? tools : tools.slice(0, collapsedCount);
  const readOnly = tools.every((t) => !t.writes);
  const count = `${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}${readOnly ? ' · read only' : ''}`;
  const title = (
    <span style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
      What Toby can do in {integration}
      <span style={{ fontSize: 'var(--size-callout)', fontWeight: 'var(--weight-regular)', color: 'var(--text-faint)' }}>{count}</span>
    </span>
  );
  const rows = visible.map((t) => (
    <div key={t.name} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '11px 14px', fontFamily: 'var(--font-system)' }}>
      <span style={{ width: '28px', height: '28px', flexShrink: 0, borderRadius: '7px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'color-mix(in srgb, var(--toby-accent) 12%, transparent)', color: 'var(--toby-accent)' }}>{t.icon || null}</span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: 'var(--size-body)', fontWeight: 'var(--weight-medium)', color: 'var(--text-row-title)' }}>{t.name}</span>
          {t.writes ? (
            <span style={{ fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-semibold)', padding: '1px 6px', borderRadius: 'var(--radius-pill)',
              background: 'color-mix(in srgb, var(--toby-text-primary) 7%, transparent)', color: 'var(--text-row-description)' }}>Makes changes</span>
          ) : null}
        </span>
        {t.description ? <span style={{ fontSize: 'var(--size-callout)', color: 'var(--text-row-description)' }}>{t.description}</span> : null}
      </span>
    </div>
  ));
  if (tools.length > collapsedCount) {
    rows.push(
      <button key="toggle" type="button" onClick={() => setOpen(!open)} style={{ height: '38px', padding: '0 14px', border: 'none', background: 'transparent',
        textAlign: 'left', cursor: 'pointer', fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', color: 'var(--text-accent)' }}>
        {open ? 'Show fewer' : `Show all ${tools.length} tools`}
      </button>
    );
  }
  return <SettingsGroup title={title}>{rows}</SettingsGroup>;
}
