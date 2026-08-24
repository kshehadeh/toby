import React from 'react';

const base = {
  fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', fontWeight: 'var(--weight-medium)',
  lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  gap: '6px', borderRadius: 'var(--radius-control)', cursor: 'pointer',
  transition: 'background var(--dur-hover) var(--ease-out), border-color var(--dur-hover) var(--ease-out)',
  padding: '0 12px', height: 'var(--form-control-height)', whiteSpace: 'nowrap'
};

const buttonVariants = {
  bordered: { background: 'var(--surface-card)', color: 'var(--text-body)', border: '1px solid var(--border-control)' },
  prominent: { background: 'var(--toby-accent)', color: 'var(--text-on-accent)', border: '1px solid transparent', fontWeight: 'var(--weight-semibold)' },
  plain: { background: 'transparent', color: 'var(--text-accent)', border: '1px solid transparent', padding: '0 2px', fontWeight: 'var(--weight-semibold)' },
  destructive: { background: 'var(--surface-card)', color: 'var(--status-danger)', border: '1px solid var(--border-control)' }
};

export function Button({ variant = 'bordered', wide = false, disabled = false, external = false, children, onClick, ...rest }) {
  const style = { ...base, ...buttonVariants[variant] || buttonVariants.bordered };
  if (wide) { style.width = '100%'; }
  if (disabled) { style.opacity = 0.4; style.cursor = 'default'; }
  return (
    <button type="button" style={style} disabled={disabled} onClick={onClick} {...rest}>
      {children}
      {external ? <span aria-hidden="true" style={{ fontSize: '10px', opacity: 0.7 }}>↗</span> : null}
    </button>
  );
}
