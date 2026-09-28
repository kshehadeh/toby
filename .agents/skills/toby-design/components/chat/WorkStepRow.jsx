import React from 'react';
import { ChevronDown, ChevronRight } from '../glyphs.jsx';

// WorkedForRow: one line of 13px secondary text ("Worked for 4s") with a
// disclosure chevron. Expanded, it lists each step: a tool glyph in the
// markdown-heading blue, a 13px semibold title, a faint count or duration,
// and a faint one-line detail (monospaced for paths), hairlines between rows.
export function WorkStepRow({ label = 'Worked for 4s', running = false, failed = false, expanded = false, steps = [], onToggle }) {
  const canExpand = steps.length > 0;
  return (
    <div style={{ maxWidth: 'var(--transcript-assistant-max)', display: 'flex', flexDirection: 'column' }}>
      <button type="button" onClick={canExpand ? onToggle : undefined} disabled={!canExpand}
        style={{ display: 'flex', alignItems: 'center', gap: '6px', border: 'none', background: 'transparent', padding: 0,
          paddingBottom: expanded ? '6px' : 0, cursor: canExpand ? 'pointer' : 'default', textAlign: 'left' }}>
        {running ? <span className="toby-pulse" style={{ width: '7px', height: '7px', borderRadius: 'var(--radius-pill)', background: 'var(--toby-accent)' }} /> : null}
        {failed ? <span style={{ width: '8px', height: '8px', borderRadius: 'var(--radius-pill)', border: '1.5px solid var(--status-error-fg)' }} /> : null}
        <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{label}</span>
        {canExpand ? <span style={{ color: 'var(--text-faint)', display: 'inline-flex' }}>{expanded ? <ChevronDown size={11} stroke={2.6} /> : <ChevronRight size={11} stroke={2.6} />}</span> : null}
      </button>
      {expanded ? (
        <div style={{ paddingLeft: '2px' }}>
          {steps.map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '12px 14px',
              borderTop: i ? '1px solid color-mix(in srgb, var(--text-body) 5%, transparent)' : 'none' }}>
              <span style={{ width: '16px', display: 'inline-flex', justifyContent: 'center', color: s.failing ? 'var(--status-error-fg)' : 'var(--toby-md-heading)' }}>{s.glyph}</span>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                  <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-body)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</span>
                  <span style={{ flex: 1 }} />
                  {s.count > 1 ? <span style={{ fontSize: 'var(--size-callout)', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{'×' + s.count}</span>
                    : s.duration ? <span style={{ fontSize: 'var(--size-callout)', color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{s.duration}</span> : null}
                </span>
                {s.detail ? (
                  <span style={{ fontFamily: s.path ? 'var(--font-mono)' : 'var(--font-system)', fontSize: s.path ? '11.5px' : 'var(--size-callout)',
                    color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.detail}</span>
                ) : null}
                {s.error ? <span style={{ fontSize: 'var(--size-callout)', color: 'var(--status-error-fg)' }}>{s.error}</span> : null}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
