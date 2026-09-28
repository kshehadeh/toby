import React from 'react';
import { MessageActions } from './MessageActions.jsx';

// AssistantMessageRow: the answer is plain SF Pro at 15px with 6pt of extra
// line spacing, left-aligned in the 720px reading column. No avatar, no
// persona label, no serif.
export function AssistantMessage({ children, timestamp, streaming = false, footer, onCopy }) {
  return (
    <div style={{ maxWidth: 'var(--transcript-assistant-max)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ fontFamily: 'var(--font-system)', fontSize: 'var(--size-answer)', color: 'var(--text-body)',
        lineHeight: 'var(--leading-answer)', textWrap: 'pretty' }}>{children}</div>
      {footer !== undefined ? footer : (!streaming ? <MessageActions copyLabel="Copy response" timestamp={timestamp} onCopy={onCopy} /> : null)}
    </div>
  );
}
