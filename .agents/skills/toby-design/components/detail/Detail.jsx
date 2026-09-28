import React from 'react';

// DetailInspect primitives (UI/Primitives/DetailInspect.swift): the building
// blocks of every workspace detail pane (Flows, Skills, Schedules, …).

// DetailSection: a 13px semibold title in row-title color, 10px above its content.
export function DetailSection({ title, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-row-title)' }}>{title}</div>
      <div style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', color: 'var(--text-row-title)', lineHeight: 1.4 }}>{children}</div>
    </div>
  );
}

// DetailMetadata: a two-column grid (16px column gap, 6px row gap) of 12px
// labels in row-description color beside 12px values in row-title color,
// both leading-aligned; `mono` values use the monospaced face.
export function DetailMetadata({ rows = [] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: '16px', rowGap: '6px', alignItems: 'baseline',
      fontFamily: 'var(--font-system)', fontSize: 'var(--size-callout)' }}>
      {rows.map((r, i) => (
        <React.Fragment key={i}>
          <span style={{ color: 'var(--text-row-description)' }}>{r.label}</span>
          <span style={{ color: 'var(--text-row-title)', fontFamily: r.mono ? 'var(--font-mono)' : 'inherit', overflowWrap: 'anywhere' }}>{r.value}</span>
        </React.Fragment>
      ))}
    </div>
  );
}
