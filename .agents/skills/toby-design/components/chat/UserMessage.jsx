import React from 'react';

export function UserMessage({ text, footer }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-3)', maxWidth: 'var(--transcript-user-max)' }}>
        <div style={{ position: 'relative', overflow: 'hidden', background: 'var(--surface-elevated)',
          border: '1px solid var(--border-hairline)', borderRadius: 'var(--radius-bubble)',
          padding: 'var(--pad-bubble-y) var(--pad-bubble-x)', fontFamily: 'var(--font-rounded)',
          fontSize: 'var(--size-body)', color: 'var(--text-body)', lineHeight: 1.45, textWrap: 'pretty' }}>
          <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '4px', background: 'var(--toby-accent)' }} />
          {text}
        </div>
        {footer ? <div style={{ fontFamily: 'var(--font-rounded)', fontSize: 'var(--size-caption)', color: 'var(--text-faint)' }}>{footer}</div> : null}
      </div>
    </div>
  );
}
