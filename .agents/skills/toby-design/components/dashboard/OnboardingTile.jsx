import React from 'react';
import { ArrowRight, CheckCircle } from '../glyphs.jsx';

// OnboardingStepTile: 148px minimum, 14px padding, 12px concentric corners.
// Resting tiles sit on the elevated fill with a separator stroke; the up-next
// tile takes a 10% accent wash, a 55% accent stroke, an "UP NEXT" badge and
// an accent-filled action. Completed tiles fade to tertiary with an accent
// check and a green "Completed" label.
export function OnboardingTile({ title, subtitle, glyph, actionLabel, upNext = false, complete = false, onAction }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 'var(--onboarding-tile-min)', boxSizing: 'border-box',
      padding: 'var(--pad-tile)', borderRadius: 'var(--radius-tile)',
      background: upNext ? 'var(--accent-wash-weak)' : 'var(--surface-elevated)',
      border: '1px solid ' + (upNext ? 'var(--accent-border)' : 'var(--border-hairline)') }}>
      {upNext ? (
        <span style={{ alignSelf: 'flex-start', marginBottom: '10px', background: 'var(--toby-accent)', color: 'var(--text-on-accent)',
          borderRadius: 'var(--radius-pill)', padding: '3px 7px', fontFamily: 'var(--font-system)', fontSize: 'var(--size-badge)',
          fontWeight: 'var(--weight-bold)', textTransform: 'uppercase', lineHeight: 1 }}>Up next</span>
      ) : null}
      <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: '10px' }}>
        <span aria-hidden="true" style={{ width: '22px', height: '22px', display: 'inline-flex', color: complete ? 'var(--text-faint)' : 'var(--text-muted)' }}>{glyph}</span>
        <span style={{ flex: 1 }} />
        {complete ? <span aria-hidden="true" style={{ color: 'var(--toby-accent)', display: 'inline-flex' }}><CheckCircle size={16} /></span> : null}
      </div>
      <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-tile-title)', fontWeight: 'var(--weight-semibold)',
        color: complete ? 'var(--text-faint)' : 'var(--text-body)', textWrap: 'pretty' }}>{title}</span>
      {subtitle ? <span style={{ marginTop: 'var(--space-2)', fontFamily: 'var(--font-system)', fontSize: 'var(--size-tile-sub)', color: 'var(--text-faint)', textWrap: 'pretty' }}>{subtitle}</span> : null}
      <span style={{ flex: 1, minHeight: '12px' }} />
      {complete ? (
        <span style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-callout)', fontWeight: 'var(--weight-medium)', color: 'var(--status-complete)' }}>Completed</span>
      ) : actionLabel ? (
        <button type="button" onClick={onAction} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
          padding: '8px 0', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
          background: upNext ? 'var(--toby-accent)' : 'var(--surface-elevated)',
          border: upNext ? '1px solid transparent' : '1px solid var(--border-hairline)',
          color: upNext ? 'var(--text-on-accent)' : 'var(--text-body)',
          fontFamily: 'var(--font-system)', fontSize: 'var(--size-callout)', fontWeight: 'var(--weight-semibold)' }}>
          {actionLabel}<ArrowRight size={10} stroke={3} />
        </button>
      ) : null}
    </div>
  );
}
