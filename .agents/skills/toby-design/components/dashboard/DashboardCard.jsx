import React from 'react';
import { Refresh, Ellipsis } from '../glyphs.jsx';

// DashboardCard + CardHeader: a content-background card with a 1px separator
// stroke and 16px concentric corners, 16px padding. The header is a 14px
// medium glyph, a 14px semibold title, an 11px medium tertiary "last ran"
// time, then a refresh glyph and an actions (…) menu, closed by a divider.
// Cards cap at 340px collapsed; overflow ends in a 40px fade and a 36px
// "Show more" bar.
export function DashboardCard({ title, glyph, lastRan, actions, refreshing = false, onRefresh, onMenu, children, showMore = false, onShowMore }) {
  const trailing = actions !== undefined ? actions : (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}>
      <button type="button" aria-label="Refresh" title={refreshing ? 'Refreshing...' : 'Refresh'} onClick={onRefresh} disabled={refreshing}
        className={refreshing ? 'toby-spin' : undefined}
        style={{ border: 'none', background: 'transparent', padding: '4px', color: 'var(--text-faint)', cursor: 'pointer', display: 'inline-flex' }}>
        <Refresh size={11} stroke={2.6} />
      </button>
      <button type="button" aria-label="Actions" title="Actions" onClick={onMenu}
        style={{ border: 'none', background: 'transparent', width: '18px', height: '18px', padding: 0, color: 'var(--text-accent)', cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
        <Ellipsis size={13} />
      </button>
    </span>
  );
  return (
    <div style={{ position: 'relative', background: 'var(--surface-content)', border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxSizing: 'border-box',
      maxHeight: showMore ? 'var(--dashboard-card-collapsed)' : undefined }}>
      <div style={{ padding: 'var(--pad-card)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingBottom: 'var(--dashboard-header-gap)',
          marginBottom: '12px', borderBottom: '1px solid var(--border-hairline)' }}>
          {glyph ? <span aria-hidden="true" style={{ display: 'inline-flex', width: '16px', height: '16px', alignItems: 'center', justifyContent: 'center', color: 'var(--text-body)' }}>{glyph}</span> : null}
          <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-card-title)', fontWeight: 'var(--weight-semibold)',
            color: 'var(--text-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
          <span style={{ flex: 1 }} />
          {lastRan ? <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-card-meta)', fontWeight: 'var(--weight-medium)',
            color: 'var(--text-faint)', whiteSpace: 'nowrap' }}>{lastRan}</span> : null}
          {trailing}
        </div>
        <div style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-card-body)', color: 'var(--text-muted)', lineHeight: 'var(--leading-card-body)' }}>{children}</div>
      </div>
      {showMore ? (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
          <div style={{ height: 'var(--dashboard-fade-height)', background: 'linear-gradient(to bottom, transparent, var(--surface-content))' }} />
          <button type="button" onClick={onShowMore} style={{ width: '100%', height: 'var(--dashboard-showmore-height)', border: 'none',
            background: 'var(--surface-content)', color: 'var(--text-accent)', fontFamily: 'var(--font-system)',
            fontSize: 'var(--size-callout)', fontWeight: 'var(--weight-semibold)', cursor: 'pointer' }}>Show more</button>
        </div>
      ) : null}
    </div>
  );
}

// DashboardStructuredSection: an optional 10px semibold uppercase eyebrow
// (+0.7px tracking, tertiary), an optional 17px semibold title, 13px muted
// body copy, and item rows (13px medium title over an 11px secondary
// subtitle) split by hairlines. Consecutive sections are split by a divider.
export function CardSection({ label, title, items, children }) {
  return (
    <div className="toby-card-section" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {label ? (
        <div style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-semibold)',
          letterSpacing: 'var(--tracking-eyebrow)', textTransform: 'uppercase', color: 'var(--text-faint)' }}>{label}</div>
      ) : null}
      {title ? <div style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-title2)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-body)' }}>{title}</div> : null}
      {children ? <div style={{ textWrap: 'pretty' }}>{children}</div> : null}
      {items && items.length ? (
        <div style={{ display: 'flex', flexDirection: 'column', paddingTop: '4px' }}>
          {items.map((it, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '2px', padding: '8px 0',
              borderTop: i ? '1px solid var(--border-hairline)' : 'none' }}>
              <span style={{ fontSize: 'var(--size-body)', fontWeight: 'var(--weight-medium)', color: 'var(--text-body)' }}>{it.title}</span>
              {it.subtitle ? <span style={{ fontSize: 'var(--size-subheadline)', color: 'var(--text-muted)' }}>{it.subtitle}</span> : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
