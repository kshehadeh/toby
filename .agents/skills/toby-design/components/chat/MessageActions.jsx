import React from 'react';
import { Copy } from '../glyphs.jsx';

// Mirrors TranscriptMessageActions: a copy glyph on the leading edge and the
// compact relative timestamp on the trailing edge, both tertiary.
export function MessageActions({ copyLabel = 'Copy', timestamp, onCopy }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', paddingTop: '2px' }}>
      <button type="button" aria-label={copyLabel} title={copyLabel} onClick={onCopy}
        style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', color: 'var(--text-faint)', display: 'inline-flex' }}>
        <Copy size={12} />
      </button>
      <span style={{ flex: 1 }} />
      {timestamp ? (
        <span style={{ fontFamily: 'var(--font-rounded)', fontSize: 'var(--size-caption)', fontWeight: 'var(--weight-medium)',
          color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>{timestamp}</span>
      ) : null}
    </div>
  );
}
