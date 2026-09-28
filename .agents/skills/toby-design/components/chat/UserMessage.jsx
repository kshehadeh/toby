import React from 'react';
import { MessageActions } from './MessageActions.jsx';

// UserMessageRow: a left-aligned bubble in the same 720px reading column as
// the answer. Elevated fill at 92%, hairline stroke, 14px corners, SF Pro 15.
export function UserMessage({ text, timestamp, footer, onCopy }) {
  return (
    <div style={{ maxWidth: 'var(--transcript-user-max)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
      <div style={{ background: 'color-mix(in srgb, var(--surface-elevated) 92%, transparent)',
        border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-bubble)',
        padding: 'var(--pad-bubble-y) var(--pad-bubble-x)', fontFamily: 'var(--font-system)',
        fontSize: 'var(--size-answer)', color: 'var(--text-body)', lineHeight: 1.35, textWrap: 'pretty', whiteSpace: 'pre-wrap' }}>
        {text}
      </div>
      <div style={{ alignSelf: 'stretch' }}>
        {footer !== undefined ? footer : <MessageActions copyLabel="Copy prompt" timestamp={timestamp} onCopy={onCopy} />}
      </div>
    </div>
  );
}
