import React from 'react';

// macOS 26 push buttons are capsules. `bordered` is the quiet grey fill
// (`.buttonStyle(.bordered)`), `prominent` the accent fill
// (`.borderedProminent`), `plain` accent text, `destructive` a bordered
// capsule with a red label.
const base = {
  fontFamily: 'var(--font-system)', fontSize: 'var(--size-body)', fontWeight: 'var(--weight-regular)',
  lineHeight: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  gap: '6px', borderRadius: 'var(--radius-pill)', cursor: 'pointer', border: 'none',
  transition: 'background var(--dur-hover) var(--ease-out)',
  padding: '0 12px', height: 'var(--form-control-height)', whiteSpace: 'nowrap'
};

const buttonVariants = {
  bordered: { background: 'var(--surface-selected)', color: 'var(--text-body)' },
  prominent: { background: 'var(--toby-accent)', color: 'var(--text-on-accent)', fontWeight: 'var(--weight-medium)' },
  plain: { background: 'transparent', color: 'var(--text-accent)', padding: '0 2px', fontWeight: 'var(--weight-medium)' },
  destructive: { background: 'var(--surface-selected)', color: 'var(--status-danger)' }
};

export function Button({ variant = 'bordered', wide = false, disabled = false, external = false, children, onClick, ...rest }) {
  const style = { ...base, ...(buttonVariants[variant] || buttonVariants.bordered) };
  if (wide) { style.width = '100%'; }
  if (disabled) { style.opacity = 0.4; style.cursor = 'default'; }
  return (
    <button type="button" style={style} disabled={disabled} onClick={onClick} {...rest}>
      {children}
      {external ? <span aria-hidden="true" style={{ fontSize: '10px', opacity: 0.7 }}>↗</span> : null}
    </button>
  );
}
