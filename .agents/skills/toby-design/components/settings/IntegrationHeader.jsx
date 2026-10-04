import React from 'react';
import { Warning } from '../glyphs.jsx';
import { groupFill } from './SettingsGroup.jsx';

// IntegrationDetailHeader (Features/Configure): the app's icon on a white
// tile, its name, a plain status and the one action that matters now:
// Connect when disconnected, a prominent Re-authorize when it needs
// attention, a quiet one when healthy. An issue adds one line under a hairline.
export function IntegrationHeader({ name, iconSrc, status = 'connected', signedInWith, actionLabel, onAction, issue }) {
  const attention = status === 'attention';
  const prominent = status === 'disconnected' || attention;
  const label = actionLabel || (status === 'disconnected' ? 'Connect' : 'Re-authorize');
  const dot = status === 'connected' ? 'var(--status-complete)' : 'var(--text-faint)';
  const statusText = { connected: 'Connected', disconnected: 'Not connected', checking: 'Checking status…' }[status];
  return (
    <div style={{ borderRadius: 'var(--radius-tile)', background: groupFill, padding: '16px', fontFamily: 'var(--font-system)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <div style={{ width: '48px', height: '48px', flexShrink: 0, boxSizing: 'border-box', borderRadius: 'var(--radius-tile)',
          background: '#fff', border: '1px solid var(--border-hairline)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {iconSrc ? <img src={iconSrc} alt="" style={{ width: '30px', height: '30px', objectFit: 'contain' }} /> : null}
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <div style={{ fontSize: 'var(--size-title2)', fontWeight: 'var(--weight-semibold)', color: 'var(--text-row-title)' }}>{name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--size-callout)', color: 'var(--text-row-description)' }}>
            {attention ? (
              <span style={{ fontSize: 'var(--size-subheadline)', fontWeight: 'var(--weight-semibold)', padding: '2px 8px',
                borderRadius: 'var(--radius-pill)', background: 'var(--status-error-bg)', color: 'var(--status-error-fg)' }}>Needs attention</span>
            ) : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ width: '7px', height: '7px', borderRadius: 'var(--radius-pill)', background: dot }} />{statusText}
              </span>
            )}
            {signedInWith && status !== 'disconnected' ? <span>{signedInWith}</span> : null}
          </div>
        </div>
        {status !== 'checking' ? (
          <button type="button" onClick={onAction} style={{ height: '28px', padding: '0 14px', borderRadius: 'var(--radius-pill)', border: 'none',
            cursor: 'pointer', fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)',
            fontWeight: prominent ? 'var(--weight-medium)' : 'var(--weight-regular)',
            background: prominent ? 'var(--toby-accent)' : 'color-mix(in srgb, var(--toby-text-primary) 8%, transparent)',
            color: prominent ? 'var(--text-on-accent)' : 'var(--text-row-title)' }}>{label}</button>
        ) : null}
      </div>
      {attention ? (
        <div style={{ borderTop: '1px solid var(--border-hairline)', marginTop: '14px', paddingTop: '12px', display: 'flex', gap: '10px' }}>
          <span style={{ color: '#d97706', display: 'inline-flex', paddingTop: '1px' }}><Warning size={15} /></span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <span style={{ fontSize: 'var(--size-body)', fontWeight: 'var(--weight-medium)', color: 'var(--text-row-title)' }}>Toby can’t reach {name} right now.</span>
            <span style={{ fontSize: 'var(--size-callout)', color: 'var(--text-row-description)' }}>{issue || `${label} to sign in again.`}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
