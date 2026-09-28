import React from 'react';
import { PlayCircle } from '../glyphs.jsx';

// Home "Actions" rail tile (DashboardActionRunnersRail): a Shortcuts-style
// colored card, 68px tall, 16px corners, filled with the flow's color preset
// (teal by default). White glyph top-left, play.circle top-right, an 11px
// semibold title at the bottom. Hover lays a 12% white wash over it; a
// running tile pulses its fill between 88% and 100%.
export function FlowRunnerCard({ title, glyph, color = 'var(--toby-accent-teal)', description, running = false, error, onRun }) {
  const [hover, setHover] = React.useState(false);
  const fg = 'rgba(255,255,255,.94)';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 'var(--action-tile-min)' }}>
      <button type="button" onClick={running ? undefined : onRun} title={description || title}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        className={running ? 'toby-tile-running' : undefined}
        style={{ position: 'relative', height: 'var(--action-tile-height)', borderRadius: 'var(--radius-lg)', border: 'none',
          padding: '10px', background: color, color: fg, cursor: running ? 'default' : 'pointer', overflow: 'hidden',
          display: 'flex', flexDirection: 'column', textAlign: 'left' }}>
        {hover && !running ? <span style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,.12)' }} /> : null}
        <span style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
          <span aria-hidden="true" style={{ display: 'inline-flex', width: '16px', height: '16px' }}>{running ? <span className="toby-spinner" /> : glyph}</span>
          <span style={{ flex: 1 }} />
          <span aria-hidden="true" style={{ display: 'inline-flex', opacity: running ? 0.55 : 0.92 }}><PlayCircle size={16} stroke={1.8} /></span>
        </span>
        <span style={{ flex: 1, minHeight: '4px' }} />
        <span style={{ position: 'relative', fontFamily: 'var(--font-system)', fontSize: 'var(--size-card-meta)', fontWeight: 'var(--weight-semibold)',
          lineHeight: 1.2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{title}</span>
      </button>
      {error ? <span style={{ fontFamily: 'var(--font-system)', fontSize: '10px', color: 'var(--status-danger)', textAlign: 'center' }}>{error}</span> : null}
    </div>
  );
}
