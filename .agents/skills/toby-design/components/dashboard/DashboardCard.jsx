import React from 'react';

const cardShell = {
  position: 'relative', background: 'var(--surface-panel)', borderRadius: 'var(--radius-lg)',
  padding: '26px', overflow: 'hidden', boxSizing: 'border-box'
};
const capRule = { position: 'absolute', left: '26px', right: '26px', top: 0, height: '2px', background: 'var(--toby-accent)', opacity: 0.85 };
const ghostGlyph = { position: 'absolute', right: '-10px', bottom: '-14px', color: 'var(--text-body)', opacity: 0.045, pointerEvents: 'none', display: 'inline-flex' };
const cardHead = { display: 'flex', alignItems: 'baseline', gap: 'var(--space-5)', marginBottom: 'var(--space-9)' };
const cardTitle = { fontFamily: 'var(--font-system)', fontSize: 'var(--size-card-title)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-body)' };
const cardMeta = { marginLeft: 'auto', fontFamily: 'var(--font-system)', fontSize: 'var(--size-card-meta)', color: 'var(--text-faint)' };

export function DashboardCard({ title, stamp, lastRan, actions, children, showMore = false }) {
  return (
    <div style={{ ...cardShell, minHeight: 'var(--dashboard-card-collapsed)', maxHeight: 'var(--dashboard-card-collapsed)' }}>
      <span style={capRule} />
      {stamp ? <span aria-hidden="true" style={ghostGlyph}>{stamp}</span> : null}
      <div style={cardHead}>
        <span style={cardTitle}>{title}</span>
        {lastRan ? <span style={cardMeta}>{lastRan}</span> : null}
        {actions ? <span style={{ marginLeft: lastRan ? 'var(--space-4)' : 'auto', display: 'flex', gap: '2px', alignSelf: 'center' }}>{actions}</span> : null}
      </div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: '14px', color: 'var(--text-muted)', lineHeight: 1.6 }}>{children}</div>
      {showMore ? (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <div style={{ height: 'var(--dashboard-fade-height)', background: 'linear-gradient(to bottom, transparent, var(--surface-panel))' }} />
          <button type="button" style={{ width: '100%', height: 'var(--dashboard-showmore-height)', border: 'none',
            background: 'var(--surface-panel)', color: 'var(--text-accent)', fontFamily: 'var(--font-system)',
            fontSize: 'var(--size-callout)', fontWeight: 'var(--weight-semibold)', cursor: 'pointer' }}>Show more</button>
        </div>
      ) : null}
    </div>
  );
}

export function CardSection({ label, children }) {
  return (
    <div style={{ marginBottom: 'var(--space-8)' }}>
      {label ? (
        <div style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-semibold)',
          letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: '5px' }}>{label}</div>
      ) : null}
      <div style={{ textWrap: 'pretty' }}>{children}</div>
    </div>
  );
}
