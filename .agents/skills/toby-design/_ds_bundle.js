/* @ds-bundle: {"format":4,"namespace":"TobyDesignSystem_28de33","components":[{"name":"AssistantMessage","sourcePath":"components/chat/AssistantMessage.jsx"},{"name":"InputDock","sourcePath":"components/chat/InputDock.jsx"},{"name":"UserMessage","sourcePath":"components/chat/UserMessage.jsx"},{"name":"WorkStepRow","sourcePath":"components/chat/WorkStepRow.jsx"},{"name":"Badge","sourcePath":"components/core/Badge.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Chip","sourcePath":"components/core/Chip.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"ProgressBar","sourcePath":"components/core/ProgressBar.jsx"},{"name":"DashboardCard","sourcePath":"components/dashboard/DashboardCard.jsx"},{"name":"CardSection","sourcePath":"components/dashboard/DashboardCard.jsx"},{"name":"FlowRunnerCard","sourcePath":"components/dashboard/FlowRunnerCard.jsx"},{"name":"OnboardingTile","sourcePath":"components/dashboard/OnboardingTile.jsx"},{"name":"InlineStatusMessage","sourcePath":"components/feedback/InlineStatusMessage.jsx"},{"name":"Skeleton","sourcePath":"components/feedback/Skeleton.jsx"},{"name":"Toast","sourcePath":"components/feedback/Toast.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"SettingsCard","sourcePath":"components/forms/SettingsCard.jsx"},{"name":"SettingsRow","sourcePath":"components/forms/SettingsRow.jsx"},{"name":"SettingsSectionHeader","sourcePath":"components/forms/SettingsSectionHeader.jsx"},{"name":"TextField","sourcePath":"components/forms/TextField.jsx"},{"name":"Toggle","sourcePath":"components/forms/Toggle.jsx"},{"name":"PersonaFooter","sourcePath":"components/navigation/PersonaFooter.jsx"},{"name":"SidebarActionGrid","sourcePath":"components/navigation/SidebarActionGrid.jsx"},{"name":"SidebarRow","sourcePath":"components/navigation/SidebarRow.jsx"},{"name":"SidebarSection","sourcePath":"components/navigation/SidebarSection.jsx"}],"sourceHashes":{"components/chat/AssistantMessage.jsx":"47f54840eeee","components/chat/InputDock.jsx":"23394a3731b2","components/chat/UserMessage.jsx":"f9bfeffcae27","components/chat/WorkStepRow.jsx":"9a94c8353b9b","components/core/Badge.jsx":"a873cfd0e90e","components/core/Button.jsx":"4104d8aeed0e","components/core/Chip.jsx":"ecca61f1a3ec","components/core/IconButton.jsx":"6b52e3d1d055","components/core/ProgressBar.jsx":"9fbfaceeeeba","components/dashboard/DashboardCard.jsx":"62f8a8112fbc","components/dashboard/FlowRunnerCard.jsx":"e9dd72270ebc","components/dashboard/OnboardingTile.jsx":"141f222f7243","components/feedback/InlineStatusMessage.jsx":"451270bdf484","components/feedback/Skeleton.jsx":"e971033591f6","components/feedback/Toast.jsx":"7bcd2c4f05a0","components/forms/Select.jsx":"df1292a934c4","components/forms/SettingsCard.jsx":"501220212429","components/forms/SettingsRow.jsx":"7150421f841a","components/forms/SettingsSectionHeader.jsx":"69e7ef15434a","components/forms/TextField.jsx":"42e9daa27ae7","components/forms/Toggle.jsx":"6ef42adf60a8","components/navigation/PersonaFooter.jsx":"ec4a5c1c5b05","components/navigation/SidebarActionGrid.jsx":"6ef366a866f7","components/navigation/SidebarRow.jsx":"9b73a0db5879","components/navigation/SidebarSection.jsx":"ee2029e2f1d7","ui_kits/toby-app/ChatScreen.jsx":"56647772b802","ui_kits/toby-app/DashboardScreen.jsx":"34d7cd2cce8c","ui_kits/toby-app/IntegrationsScreen.jsx":"2f03dff69d94","ui_kits/toby-app/SettingsScreen.jsx":"850d735f20d3","ui_kits/toby-app/Sidebar.jsx":"f3c697f429c9","ui_kits/toby-app/data.js":"271fa64d51be"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.TobyDesignSystem_28de33 = window.TobyDesignSystem_28de33 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/chat/AssistantMessage.jsx
try { (() => {
function AssistantMessage({
  header = 'Toby',
  avatarSrc,
  children,
  footer
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-5)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '28px',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 'var(--space-3)'
    }
  }, avatarSrc ? /*#__PURE__*/React.createElement("img", {
    src: avatarSrc,
    alt: "",
    width: "28",
    height: "28",
    style: {
      width: '28px',
      height: '28px',
      borderRadius: 'var(--radius-pill)',
      objectFit: 'cover'
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      width: '28px',
      height: '28px',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--surface-elevated)'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      width: '1px',
      background: 'var(--border-hairline)',
      minHeight: '12px'
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--transcript-assistant-max)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-rounded)',
      fontSize: 'var(--size-caption)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-muted)'
    }
  }, header), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: 'var(--size-answer)',
      color: 'var(--text-body)',
      lineHeight: 'var(--leading-answer)',
      textWrap: 'pretty'
    }
  }, children), footer ? /*#__PURE__*/React.createElement("div", {
    style: {
      paddingTop: '2px'
    }
  }, footer) : null));
}
Object.assign(__ds_scope, { AssistantMessage });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chat/AssistantMessage.jsx", error: String((e && e.message) || e) }); }

// components/chat/InputDock.jsx
try { (() => {
function InputDock({
  value = '',
  placeholder = 'Ask Toby to handle something',
  hint = true,
  contextPercent,
  attachments,
  loading = false,
  onChange,
  onSubmit
}) {
  const canSubmit = !loading && value.trim().length > 0;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-content)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-lg)',
      boxShadow: 'var(--shadow-dock)',
      display: 'flex',
      flexDirection: 'column'
    }
  }, attachments ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 'var(--space-3)',
      padding: '10px 12px 0',
      overflow: 'hidden'
    }
  }, attachments) : null, /*#__PURE__*/React.createElement("textarea", {
    rows: "2",
    value: value,
    placeholder: placeholder,
    disabled: loading,
    onChange: onChange ? e => onChange(e.target.value) : undefined,
    style: {
      resize: 'none',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      color: 'var(--text-body)',
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-body)',
      lineHeight: 1.45,
      padding: '12px var(--pad-dock-x) 8px'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      padding: '0 12px 10px',
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-caption)',
      color: 'var(--text-muted)'
    }
  }, hint ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", null, "Return to send"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)'
    }
  }, "Shift+Return for newline")) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Add files",
    style: {
      width: '26px',
      height: '26px',
      borderRadius: 'var(--radius-pill)',
      border: 'none',
      background: 'var(--surface-selected)',
      color: 'var(--text-muted)',
      cursor: 'pointer',
      fontSize: '13px'
    }
  }, "+"), typeof contextPercent === 'number' ? /*#__PURE__*/React.createElement("span", {
    title: 'Context window: ' + contextPercent + '% full',
    "aria-label": "Context window",
    style: {
      width: '16px',
      height: '16px',
      borderRadius: 'var(--radius-pill)',
      flexShrink: 0,
      background: 'conic-gradient(' + (contextPercent >= 80 ? 'var(--toby-accent-orange)' : 'var(--text-muted)') + ' ' + contextPercent + '%, color-mix(in srgb, var(--text-faint) 38%, transparent) 0)',
      mask: 'radial-gradient(circle, transparent 4px, #000 5px)',
      WebkitMask: 'radial-gradient(circle, transparent 4px, #000 5px)'
    }
  }) : null, /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Send",
    disabled: !canSubmit,
    onClick: onSubmit,
    style: {
      width: '26px',
      height: '26px',
      borderRadius: 'var(--radius-pill)',
      border: 'none',
      cursor: canSubmit ? 'pointer' : 'default',
      background: canSubmit ? 'var(--text-body)' : 'var(--surface-selected)',
      color: canSubmit ? 'var(--surface-content)' : 'var(--text-faint)',
      fontSize: '13px'
    }
  }, "\u2191")));
}
Object.assign(__ds_scope, { InputDock });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chat/InputDock.jsx", error: String((e && e.message) || e) }); }

// components/chat/UserMessage.jsx
try { (() => {
function UserMessage({
  text,
  footer
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 'var(--space-3)',
      maxWidth: 'var(--transcript-user-max)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      overflow: 'hidden',
      background: 'var(--surface-elevated)',
      border: '1px solid var(--border-hairline)',
      borderRadius: 'var(--radius-bubble)',
      padding: 'var(--pad-bubble-y) var(--pad-bubble-x)',
      fontFamily: 'var(--font-rounded)',
      fontSize: 'var(--size-body)',
      color: 'var(--text-body)',
      lineHeight: 1.45,
      textWrap: 'pretty'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: '4px',
      background: 'var(--toby-accent)'
    }
  }), text), footer ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-rounded)',
      fontSize: 'var(--size-caption)',
      color: 'var(--text-faint)'
    }
  }, footer) : null));
}
Object.assign(__ds_scope, { UserMessage });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chat/UserMessage.jsx", error: String((e && e.message) || e) }); }

// components/chat/WorkStepRow.jsx
try { (() => {
function WorkStepRow({
  title,
  body,
  duration,
  count,
  glyph,
  active = false,
  expandable = false,
  expanded = false,
  onToggle
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: expandable ? onToggle : undefined,
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-5)',
      border: 'none',
      background: 'transparent',
      padding: '6px 0',
      textAlign: 'left',
      cursor: expandable ? 'pointer' : 'default',
      width: '100%'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: '16px',
      height: '16px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      color: 'var(--text-accent)'
    }
  }, glyph || /*#__PURE__*/React.createElement("span", {
    style: {
      width: active ? '9px' : '7px',
      height: active ? '9px' : '7px',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--toby-accent)',
      opacity: active ? 0.6 : 1
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: '2px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 'var(--space-4)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-rounded)',
      fontSize: 'var(--size-step-meta)',
      fontWeight: 'var(--weight-semibold)',
      letterSpacing: 'var(--tracking-step-meta)',
      textTransform: 'uppercase',
      color: 'var(--text-muted)'
    }
  }, title), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), count > 1 ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-rounded)',
      fontSize: 'var(--size-step-meta)',
      color: 'var(--text-faint)'
    }
  }, '×' + count) : null, duration ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-rounded)',
      fontSize: 'var(--size-step-meta)',
      color: 'var(--text-faint)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, duration) : null, expandable ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      fontSize: '9px',
      color: 'var(--text-faint)',
      transform: expanded ? 'rotate(90deg)' : 'none',
      transition: 'transform var(--dur-expand) var(--ease-out)'
    }
  }, "\u25B6") : null), !expanded && body ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-rounded)',
      fontSize: 'var(--size-step-meta)',
      color: 'var(--text-faint)',
      lineHeight: 1.45
    }
  }, body) : null)), expanded && body ? /*#__PURE__*/React.createElement("div", {
    style: {
      paddingLeft: '26px',
      paddingBottom: '6px',
      fontFamily: 'var(--font-rounded)',
      fontSize: 'var(--size-step-meta)',
      color: 'var(--text-faint)',
      whiteSpace: 'pre-wrap'
    }
  }, body) : null);
}
Object.assign(__ds_scope, { WorkStepRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/chat/WorkStepRow.jsx", error: String((e && e.message) || e) }); }

// components/core/Badge.jsx
try { (() => {
function Badge({
  tone = 'neutral',
  children
}) {
  const tones = {
    neutral: {
      background: 'color-mix(in srgb, var(--text-faint) 12%, transparent)',
      color: 'var(--text-faint)',
      border: '1px solid color-mix(in srgb, var(--text-faint) 30%, transparent)'
    },
    accent: {
      background: 'var(--toby-accent)',
      color: 'var(--text-on-accent)',
      border: '1px solid transparent'
    },
    accentSoft: {
      background: 'var(--accent-wash-weak)',
      color: 'var(--text-accent)',
      border: '1px solid var(--accent-border-soft)'
    }
  };
  const t = tones[tone] || tones.neutral;
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-badge)',
      fontWeight: 'var(--weight-bold)',
      letterSpacing: '.04em',
      textTransform: 'uppercase',
      padding: '3px 7px',
      lineHeight: 1,
      ...t
    }
  }, children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Badge.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const base = {
  fontFamily: 'var(--font-system)',
  fontSize: 'var(--size-body)',
  fontWeight: 'var(--weight-medium)',
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  borderRadius: 'var(--radius-control)',
  cursor: 'pointer',
  transition: 'background var(--dur-hover) var(--ease-out), border-color var(--dur-hover) var(--ease-out)',
  padding: '0 12px',
  height: 'var(--form-control-height)',
  whiteSpace: 'nowrap'
};
const buttonVariants = {
  bordered: {
    background: 'var(--surface-card)',
    color: 'var(--text-body)',
    border: '1px solid var(--border-control)'
  },
  prominent: {
    background: 'var(--toby-accent)',
    color: 'var(--text-on-accent)',
    border: '1px solid transparent',
    fontWeight: 'var(--weight-semibold)'
  },
  plain: {
    background: 'transparent',
    color: 'var(--text-accent)',
    border: '1px solid transparent',
    padding: '0 2px',
    fontWeight: 'var(--weight-semibold)'
  },
  destructive: {
    background: 'var(--surface-card)',
    color: 'var(--status-danger)',
    border: '1px solid var(--border-control)'
  }
};
function Button({
  variant = 'bordered',
  wide = false,
  disabled = false,
  external = false,
  children,
  onClick,
  ...rest
}) {
  const style = {
    ...base,
    ...(buttonVariants[variant] || buttonVariants.bordered)
  };
  if (wide) {
    style.width = '100%';
  }
  if (disabled) {
    style.opacity = 0.4;
    style.cursor = 'default';
  }
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    style: style,
    disabled: disabled,
    onClick: onClick
  }, rest), children, external ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      fontSize: '10px',
      opacity: 0.7
    }
  }, "\u2197") : null);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Chip.jsx
try { (() => {
function Chip({
  leading,
  label,
  meta,
  onRemove
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      background: 'var(--surface-selected)',
      borderRadius: 'var(--radius-pill)',
      padding: 'var(--pad-chip-y) var(--pad-chip-x)',
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-callout)',
      color: 'var(--text-muted)',
      maxWidth: '260px'
    }
  }, leading ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      width: '12px',
      height: '12px',
      color: 'var(--text-accent)'
    }
  }, leading) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, label), meta ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-faint)'
    }
  }, meta) : null, onRemove ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": 'Remove ' + label,
    onClick: onRemove,
    style: {
      border: 'none',
      background: 'transparent',
      color: 'var(--text-muted)',
      cursor: 'pointer',
      width: '16px',
      height: '16px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '10px',
      fontWeight: 700
    }
  }, "\u2715") : null);
}
Object.assign(__ds_scope, { Chip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Chip.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const iconButtonSizes = {
  sm: 22,
  md: 26,
  lg: 34
};
function IconButton({
  glyph,
  label,
  tone = 'muted',
  size = 'md',
  disabled = false,
  filled = true,
  onClick,
  ...rest
}) {
  const px = iconButtonSizes[size] || iconButtonSizes.md;
  const tones = {
    muted: {
      background: filled ? 'var(--surface-selected)' : 'transparent',
      color: 'var(--text-muted)'
    },
    faint: {
      background: filled ? 'var(--surface-selected)' : 'transparent',
      color: 'var(--text-faint)'
    },
    accent: {
      background: filled ? 'var(--accent-wash)' : 'transparent',
      color: 'var(--text-accent)'
    },
    inverted: {
      background: 'var(--text-body)',
      color: 'var(--surface-content)'
    }
  };
  const t = tones[tone] || tones.muted;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: "button",
    "aria-label": label,
    title: label,
    disabled: disabled,
    onClick: onClick,
    style: {
      width: px + 'px',
      height: px + 'px',
      borderRadius: 'var(--radius-pill)',
      border: 'none',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.45 : 1,
      transition: 'background var(--dur-hover) var(--ease-out)',
      ...t
    }
  }, rest), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      display: 'inline-flex',
      width: Math.round(px * 0.54) + 'px',
      height: Math.round(px * 0.54) + 'px'
    }
  }, glyph));
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/ProgressBar.jsx
try { (() => {
function ProgressBar({
  progress = 0,
  height = 3
}) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return /*#__PURE__*/React.createElement("div", {
    role: "progressbar",
    "aria-valuenow": Math.round(pct),
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    style: {
      width: '100%',
      height: height + 'px',
      borderRadius: 'var(--radius-pill)',
      background: 'color-mix(in srgb, var(--text-body) 10%, transparent)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: pct + '%',
      height: '100%',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--toby-accent)',
      transition: 'width var(--dur-section) var(--ease-out)'
    }
  }));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/dashboard/DashboardCard.jsx
try { (() => {
const cardShell = {
  position: 'relative',
  background: 'var(--surface-panel)',
  borderRadius: 'var(--radius-lg)',
  padding: '26px',
  overflow: 'hidden',
  boxSizing: 'border-box'
};
const capRule = {
  position: 'absolute',
  left: '26px',
  right: '26px',
  top: 0,
  height: '2px',
  background: 'var(--toby-accent)',
  opacity: 0.85
};
const ghostGlyph = {
  position: 'absolute',
  right: '-10px',
  bottom: '-14px',
  color: 'var(--text-body)',
  opacity: 0.045,
  pointerEvents: 'none',
  display: 'inline-flex'
};
const cardHead = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 'var(--space-5)',
  marginBottom: 'var(--space-9)'
};
const cardTitle = {
  fontFamily: 'var(--font-system)',
  fontSize: 'var(--size-card-title)',
  fontWeight: 'var(--weight-semibold)',
  color: 'var(--text-body)'
};
const cardMeta = {
  marginLeft: 'auto',
  fontFamily: 'var(--font-system)',
  fontSize: 'var(--size-card-meta)',
  color: 'var(--text-faint)'
};
function DashboardCard({
  title,
  stamp,
  lastRan,
  actions,
  children,
  showMore = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      ...cardShell,
      minHeight: 'var(--dashboard-card-collapsed)',
      maxHeight: 'var(--dashboard-card-collapsed)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: capRule
  }), stamp ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: ghostGlyph
  }, stamp) : null, /*#__PURE__*/React.createElement("div", {
    style: cardHead
  }, /*#__PURE__*/React.createElement("span", {
    style: cardTitle
  }, title), lastRan ? /*#__PURE__*/React.createElement("span", {
    style: cardMeta
  }, lastRan) : null, actions ? /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: lastRan ? 'var(--space-4)' : 'auto',
      display: 'flex',
      gap: '2px',
      alignSelf: 'center'
    }
  }, actions) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '14px',
      color: 'var(--text-muted)',
      lineHeight: 1.6
    }
  }, children), showMore ? /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 'var(--dashboard-fade-height)',
      background: 'linear-gradient(to bottom, transparent, var(--surface-panel))'
    }
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    style: {
      width: '100%',
      height: 'var(--dashboard-showmore-height)',
      border: 'none',
      background: 'var(--surface-panel)',
      color: 'var(--text-accent)',
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-callout)',
      fontWeight: 'var(--weight-semibold)',
      cursor: 'pointer'
    }
  }, "Show more")) : null);
}
function CardSection({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 'var(--space-8)'
    }
  }, label ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-caption)',
      fontWeight: 'var(--weight-semibold)',
      letterSpacing: '.09em',
      textTransform: 'uppercase',
      color: 'var(--text-faint)',
      marginBottom: '5px'
    }
  }, label) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      textWrap: 'pretty'
    }
  }, children));
}
Object.assign(__ds_scope, { DashboardCard, CardSection });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/dashboard/DashboardCard.jsx", error: String((e && e.message) || e) }); }

// components/dashboard/FlowRunnerCard.jsx
try { (() => {
function FlowRunnerCard({
  title,
  description,
  stamp,
  running = false,
  error,
  onRun
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      background: 'var(--surface-panel)',
      borderRadius: 'var(--radius-lg)',
      padding: '26px',
      overflow: 'hidden',
      boxSizing: 'border-box',
      display: 'flex',
      flexDirection: 'column',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '26px',
      right: '26px',
      top: 0,
      height: '2px',
      background: 'var(--toby-accent)',
      opacity: 0.85
    }
  }), stamp ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      position: 'absolute',
      right: '-10px',
      bottom: '-14px',
      color: 'var(--text-body)',
      opacity: 0.045,
      pointerEvents: 'none',
      display: 'inline-flex'
    }
  }, stamp) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 'var(--space-5)',
      marginBottom: 'var(--space-9)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-card-title)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-body)'
    }
  }, title)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-serif)',
      fontSize: '14px',
      lineHeight: 1.6,
      color: 'var(--text-muted)',
      textWrap: 'pretty'
    }
  }, description), error ? /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'var(--space-4)',
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-callout)',
      color: 'var(--status-danger)'
    }
  }, error) : null, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 'var(--space-8)'
    }
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onRun,
    disabled: running,
    style: {
      width: '100%',
      height: '30px',
      borderRadius: 'var(--radius-control)',
      border: '1px solid transparent',
      background: 'var(--toby-accent)',
      color: 'var(--text-on-accent)',
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-body)',
      fontWeight: 'var(--weight-semibold)',
      cursor: running ? 'default' : 'pointer',
      opacity: running ? 0.5 : 1,
      transition: 'opacity var(--dur-hover) var(--ease-out)'
    }
  }, running ? 'Running…' : 'Run Now'));
}
Object.assign(__ds_scope, { FlowRunnerCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/dashboard/FlowRunnerCard.jsx", error: String((e && e.message) || e) }); }

// components/dashboard/OnboardingTile.jsx
try { (() => {
function OnboardingTile({
  title,
  subtitle,
  glyph,
  actionLabel,
  upNext = false,
  complete = false,
  onAction
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      minHeight: 'var(--onboarding-tile-min)',
      boxSizing: 'border-box',
      padding: 'var(--pad-tile)',
      borderRadius: 'var(--radius-tile)',
      background: upNext ? 'var(--accent-wash-weak)' : 'var(--surface-elevated)',
      border: '1px solid ' + (upNext ? 'var(--accent-border)' : 'var(--border-hairline)')
    }
  }, upNext ? /*#__PURE__*/React.createElement("span", {
    style: {
      alignSelf: 'flex-start',
      marginBottom: '10px',
      background: 'var(--toby-accent)',
      color: 'var(--text-on-accent)',
      borderRadius: 'var(--radius-pill)',
      padding: '3px 7px',
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-badge)',
      fontWeight: 'var(--weight-bold)',
      letterSpacing: '.04em',
      textTransform: 'uppercase',
      lineHeight: 1
    }
  }, "Up next") : null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      marginBottom: '10px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: '22px',
      height: '22px',
      display: 'inline-flex',
      color: complete ? 'var(--text-faint)' : 'var(--text-muted)'
    }
  }, glyph), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), complete ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      color: 'var(--toby-accent)',
      fontSize: '15px'
    }
  }, "\u2713") : null), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-tile-title)',
      fontWeight: 'var(--weight-semibold)',
      color: complete ? 'var(--text-faint)' : 'var(--text-body)',
      textWrap: 'pretty'
    }
  }, title), subtitle ? /*#__PURE__*/React.createElement("span", {
    style: {
      marginTop: 'var(--space-2)',
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-tile-sub)',
      color: 'var(--text-faint)',
      textWrap: 'pretty'
    }
  }, subtitle) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minHeight: '12px'
    }
  }), complete ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-callout)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--status-complete)'
    }
  }, "Completed") : actionLabel ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onAction,
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '6px',
      padding: '8px 0',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      background: upNext ? 'var(--toby-accent)' : 'var(--surface-elevated)',
      border: upNext ? '1px solid transparent' : '1px solid var(--border-hairline)',
      color: upNext ? 'var(--text-on-accent)' : 'var(--text-body)',
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-callout)',
      fontWeight: 'var(--weight-semibold)'
    }
  }, actionLabel, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      fontSize: '10px'
    }
  }, "\u2192")) : null);
}
Object.assign(__ds_scope, { OnboardingTile });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/dashboard/OnboardingTile.jsx", error: String((e && e.message) || e) }); }

// components/feedback/InlineStatusMessage.jsx
try { (() => {
function InlineStatusMessage({
  tone = 'success',
  message,
  glyph
}) {
  const tones = {
    success: {
      background: 'var(--status-success-bg)',
      border: 'var(--status-success-border)',
      color: 'var(--status-success-fg)',
      mark: '✓'
    },
    error: {
      background: 'var(--status-error-bg)',
      border: 'var(--status-error-border)',
      color: 'var(--status-error-fg)',
      mark: '!'
    }
  };
  const t = tones[tone] || tones.success;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-4)',
      padding: '10px 12px',
      background: t.background,
      border: '1px solid ' + t.border,
      borderRadius: 'var(--radius-control)',
      color: t.color,
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-subheadline)',
      lineHeight: 1.45
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: '14px',
      textAlign: 'center',
      fontWeight: 'var(--weight-semibold)',
      flexShrink: 0
    }
  }, glyph || t.mark), /*#__PURE__*/React.createElement("span", {
    style: {
      textWrap: 'pretty'
    }
  }, message));
}
Object.assign(__ds_scope, { InlineStatusMessage });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/InlineStatusMessage.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Skeleton.jsx
try { (() => {
function Skeleton({
  lines = 4,
  height = 12
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-4)'
    },
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("style", null, '@keyframes tobySkeletonPulse{0%{opacity:.9}100%{opacity:.5}}'), Array.from({
    length: lines
  }).map((_, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      height: height + 'px',
      borderRadius: 'var(--radius-skeleton)',
      background: 'var(--surface-elevated)',
      animation: 'tobySkeletonPulse var(--dur-skeleton) var(--ease-in-out) infinite alternate'
    }
  })));
}
Object.assign(__ds_scope, { Skeleton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Skeleton.jsx", error: String((e && e.message) || e) }); }

// components/feedback/Toast.jsx
try { (() => {
function Toast({
  style = 'success',
  title,
  message,
  actionLabel,
  onAction,
  onDismiss
}) {
  const marks = {
    success: {
      glyph: '✓',
      color: 'var(--control-toggle-on)'
    },
    error: {
      glyph: '✕',
      color: 'var(--status-danger)'
    },
    progress: {
      glyph: '◌',
      color: 'var(--text-accent)'
    }
  };
  const m = marks[style] || marks.success;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'flex-start',
      gap: 'var(--space-6)',
      maxWidth: 'var(--toast-max)',
      padding: '12px 14px',
      borderRadius: 'var(--radius-lg)',
      background: 'var(--surface-elevated)',
      backdropFilter: 'var(--blur-material)',
      border: '1px solid var(--border-hairline)',
      boxShadow: 'var(--shadow-toast)',
      fontFamily: 'var(--font-system)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: '24px',
      height: '24px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: m.color,
      fontSize: '15px',
      fontWeight: 700
    }
  }, m.glyph), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--size-subheadline)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-body)'
    }
  }, title), message ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--size-caption)',
      color: 'var(--text-muted)',
      lineHeight: 1.45,
      textWrap: 'pretty'
    }
  }, message) : null, actionLabel ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onAction,
    style: {
      alignSelf: 'flex-start',
      border: 'none',
      background: 'transparent',
      color: 'var(--text-accent)',
      fontSize: 'var(--size-caption)',
      fontWeight: 'var(--weight-semibold)',
      cursor: 'pointer',
      padding: 0,
      marginTop: '2px'
    }
  }, actionLabel) : null), style !== 'progress' ? /*#__PURE__*/React.createElement("button", {
    type: "button",
    "aria-label": "Dismiss",
    onClick: onDismiss,
    style: {
      border: 'none',
      background: 'transparent',
      color: 'var(--text-faint)',
      cursor: 'pointer',
      width: '22px',
      height: '22px',
      fontSize: '10px',
      fontWeight: 700
    }
  }, "\u2715") : null);
}
Object.assign(__ds_scope, { Toast });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/feedback/Toast.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function Select({
  value,
  options = [],
  minWidth = 120,
  maxWidth = 320,
  onChange,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("select", _extends({
    value: value,
    onChange: onChange ? e => onChange(e.target.value) : undefined,
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-body)',
      color: 'var(--text-body)',
      background: 'var(--surface-card)',
      border: '1px solid var(--border-control)',
      borderRadius: 'var(--radius-control)',
      height: 'var(--form-control-height)',
      padding: '0 6px',
      minWidth: minWidth + 'px',
      maxWidth: maxWidth + 'px'
    }
  }, rest), options.map(o => /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label)));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/SettingsCard.jsx
try { (() => {
function SettingsCard({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      background: 'var(--surface-card)',
      borderRadius: 'var(--radius-card)',
      border: '1px solid var(--border-card)',
      overflow: 'hidden',
      maxWidth: 'var(--settings-content-max)'
    }
  }, children);
}
Object.assign(__ds_scope, { SettingsCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SettingsCard.jsx", error: String((e && e.message) || e) }); }

// components/forms/SettingsRow.jsx
try { (() => {
function SettingsRow({
  title,
  description,
  showsDivider = true,
  children
}) {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-8)',
      padding: 'var(--pad-row-y) var(--pad-row-x)',
      minHeight: 'var(--form-row-height)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-row-title)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-row-title)'
    }
  }, title), description ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-subheadline)',
      color: 'var(--text-row-description)',
      textWrap: 'pretty'
    }
  }, description) : null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)'
    }
  }, children)), showsDivider ? /*#__PURE__*/React.createElement("div", {
    style: {
      height: '1px',
      background: 'var(--border-card)',
      marginLeft: 'var(--pad-row-x)'
    }
  }) : null);
}
Object.assign(__ds_scope, { SettingsRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SettingsRow.jsx", error: String((e && e.message) || e) }); }

// components/forms/SettingsSectionHeader.jsx
try { (() => {
function SettingsSectionHeader({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-subheadline)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-section-header)',
      paddingLeft: 'var(--space-2)',
      paddingBottom: 'var(--space-3)'
    }
  }, children);
}
Object.assign(__ds_scope, { SettingsSectionHeader });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/SettingsSectionHeader.jsx", error: String((e && e.message) || e) }); }

// components/forms/TextField.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
function TextField({
  value = '',
  placeholder = '',
  secure = false,
  minWidth = 120,
  maxWidth = 220,
  onChange,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("input", _extends({
    type: secure ? 'password' : 'text',
    value: value,
    placeholder: placeholder,
    onChange: onChange ? e => onChange(e.target.value) : undefined,
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-body)',
      color: 'var(--text-body)',
      background: 'var(--surface-content)',
      border: '1px solid var(--border-control)',
      borderRadius: 'var(--radius-control)',
      height: 'var(--form-control-height)',
      padding: '0 8px',
      minWidth: minWidth + 'px',
      maxWidth: maxWidth + 'px',
      outline: 'none'
    }
  }, rest));
}
Object.assign(__ds_scope, { TextField });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/TextField.jsx", error: String((e && e.message) || e) }); }

// components/forms/Toggle.jsx
try { (() => {
function Toggle({
  checked = false,
  disabled = false,
  label = '',
  onChange
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    role: "switch",
    "aria-checked": checked,
    "aria-label": label || undefined,
    disabled: disabled,
    onClick: onChange ? () => onChange(!checked) : undefined,
    style: {
      width: '38px',
      height: '22px',
      borderRadius: 'var(--radius-pill)',
      border: 'none',
      padding: '2px',
      background: checked ? 'var(--control-toggle-on)' : 'color-mix(in srgb, var(--text-faint) 35%, transparent)',
      opacity: disabled ? 0.45 : 1,
      cursor: disabled ? 'default' : 'pointer',
      display: 'inline-flex',
      justifyContent: checked ? 'flex-end' : 'flex-start',
      alignItems: 'center',
      transition: 'background var(--dur-hover) var(--ease-out)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: '18px',
      height: '18px',
      borderRadius: 'var(--radius-pill)',
      background: '#fff',
      boxShadow: '0 1px 2px rgba(0,0,0,.25)',
      display: 'block'
    }
  }));
}
Object.assign(__ds_scope, { Toggle });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Toggle.jsx", error: String((e && e.message) || e) }); }

// components/navigation/PersonaFooter.jsx
try { (() => {
function PersonaFooter({
  name = 'Toby',
  model = '',
  imageSrc,
  open = false,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      width: '100%',
      textAlign: 'left',
      padding: 'var(--space-4)',
      border: 'none',
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      background: open || hover ? 'var(--surface-selected)' : 'transparent',
      transition: 'background var(--dur-hover) var(--ease-out)'
    }
  }, imageSrc ? /*#__PURE__*/React.createElement("img", {
    src: imageSrc,
    alt: "",
    width: "32",
    height: "32",
    style: {
      width: '32px',
      height: '32px',
      borderRadius: 'var(--radius-pill)',
      objectFit: 'cover',
      flexShrink: 0
    }
  }) : /*#__PURE__*/React.createElement("span", {
    style: {
      width: '32px',
      height: '32px',
      borderRadius: 'var(--radius-pill)',
      background: 'var(--surface-elevated)',
      flexShrink: 0
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-2)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-callout)',
      color: 'var(--text-body)'
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-caption)',
      color: 'var(--text-faint)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, model)), /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      color: 'var(--text-faint)',
      fontSize: '9px',
      lineHeight: 1.1,
      textAlign: 'center'
    }
  }, "\u25B2", /*#__PURE__*/React.createElement("br", null), "\u25BC"));
}
Object.assign(__ds_scope, { PersonaFooter });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/PersonaFooter.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SidebarActionGrid.jsx
try { (() => {
function GridButton({
  item,
  selected,
  onSelect
}) {
  const [hover, setHover] = React.useState(false);
  const tint = item.color || 'var(--toby-accent)';
  const bg = selected ? 'color-mix(in srgb,' + tint + ' 22%, transparent)' : hover ? 'color-mix(in srgb,' + tint + ' 18%, transparent)' : 'transparent';
  const fg = selected || hover ? tint : 'var(--text-muted)';
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    title: item.title,
    "aria-label": item.title,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    onClick: onSelect ? () => onSelect(item.id) : undefined,
    style: {
      minHeight: '34px',
      border: 'none',
      borderRadius: 'var(--radius-sm)',
      background: bg,
      color: fg,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      transition: 'background var(--dur-hover) var(--ease-out), color var(--dur-hover) var(--ease-out)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: '18px',
      height: '18px',
      display: 'inline-flex'
    }
  }, item.glyph));
}
function SidebarActionGrid({
  items = [],
  selectedId,
  onSelect
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 'var(--gap-grid)',
      padding: '6px 0 8px'
    }
  }, items.map(item => /*#__PURE__*/React.createElement(GridButton, {
    key: item.id,
    item: item,
    selected: item.id === selectedId,
    onSelect: onSelect
  })));
}
Object.assign(__ds_scope, { SidebarActionGrid });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SidebarActionGrid.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SidebarRow.jsx
try { (() => {
function SidebarRow({
  title,
  subtitle,
  glyph,
  selected = false,
  trailing,
  onClick
}) {
  const [hover, setHover] = React.useState(false);
  const fill = selected ? 'var(--surface-selected)' : hover ? 'var(--surface-hover)' : 'transparent';
  const fg = selected ? 'var(--text-body)' : 'var(--text-muted)';
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => setHover(false),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 'var(--space-4)',
      width: '100%',
      textAlign: 'left',
      padding: '7px 8px',
      border: 'none',
      background: fill,
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      transition: 'background var(--dur-hover) var(--ease-out)'
    }
  }, glyph ? /*#__PURE__*/React.createElement("span", {
    "aria-hidden": "true",
    style: {
      width: '16px',
      height: '16px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: fg,
      flexShrink: 0
    }
  }, glyph) : null, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: '1px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-callout)',
      color: fg,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, title), subtitle ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-caption)',
      color: 'var(--text-faint)',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    }
  }, subtitle) : null), trailing ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      display: 'inline-flex',
      flexShrink: 0
    }
  }, trailing) : null);
}
Object.assign(__ds_scope, { SidebarRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SidebarRow.jsx", error: String((e && e.message) || e) }); }

// components/navigation/SidebarSection.jsx
try { (() => {
function SidebarSection({
  title,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      marginBottom: 'var(--space-6)'
    }
  }, title ? /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-system)',
      fontSize: 'var(--size-caption)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-faint)',
      letterSpacing: '.06em',
      textTransform: 'uppercase',
      padding: '0 8px 4px'
    }
  }, title) : null, children);
}
Object.assign(__ds_scope, { SidebarSection });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/SidebarSection.jsx", error: String((e && e.message) || e) }); }

// ui_kits/toby-app/ChatScreen.jsx
try { (() => {
const {
  InputDock,
  UserMessage,
  AssistantMessage,
  WorkStepRow,
  Button
} = window.TobyDesignSystem_28de33;
function SuggestionList({
  onPick
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, window.TobyKitData.suggestions.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.text,
    type: "button",
    onClick: () => onPick(s.text),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '10px 0',
      border: 'none',
      borderBottom: '1px solid var(--border-hairline)',
      background: 'transparent',
      cursor: 'pointer',
      textAlign: 'left',
      color: 'var(--text-muted)',
      fontSize: 'var(--size-callout)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 16,
      display: 'inline-flex',
      color: 'var(--text-faint)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: s.icon,
    size: 14
  })), /*#__PURE__*/React.createElement("span", null, s.text))));
}
function ChatScreen({
  turns,
  draft,
  setDraft,
  onSend
}) {
  const empty = turns.length === 0;
  if (empty) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '0 var(--pad-content)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 560,
        display: 'flex',
        flexDirection: 'column',
        gap: 18
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 14
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: "../../assets/personas/toby.png",
      alt: "",
      width: "96",
      height: "96",
      style: {
        borderRadius: 999
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 'var(--size-title2)',
        fontWeight: 'var(--weight-semibold)',
        color: 'var(--text-body)'
      }
    }, "What should Toby take care of?"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 'var(--size-callout)',
        color: 'var(--text-muted)',
        textAlign: 'center'
      }
    }, "Use your connected apps, schedules, memory, and Mac controls from one place."))), /*#__PURE__*/React.createElement(InputDock, {
      value: draft,
      onChange: setDraft,
      onSubmit: onSend,
      contextPercent: 12
    }), /*#__PURE__*/React.createElement(SuggestionList, {
      onPick: setDraft
    })));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      height: '100%',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      overflow: 'auto',
      padding: 'var(--pad-content) var(--pad-content) 150px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 720,
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 18
    }
  }, turns.map((t, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, /*#__PURE__*/React.createElement(UserMessage, {
    text: t.prompt,
    footer: /*#__PURE__*/React.createElement(Button, {
      variant: "plain"
    }, "Copy prompt")
  }), /*#__PURE__*/React.createElement("div", null, t.steps.map(s => /*#__PURE__*/React.createElement(WorkStepRow, {
    key: s.title,
    title: s.title,
    body: s.body,
    duration: s.duration,
    count: s.count,
    glyph: s.icon ? /*#__PURE__*/React.createElement(Icon, {
      name: s.icon,
      size: 11
    }) : null,
    active: s.active,
    expandable: !!s.body
  }))), t.answer ? /*#__PURE__*/React.createElement(AssistantMessage, {
    header: "Toby",
    avatarSrc: "../../assets/personas/toby.png",
    footer: /*#__PURE__*/React.createElement(Button, {
      variant: "plain"
    }, "Copy response")
  }, t.answer.split('\n\n').map((p, j) => /*#__PURE__*/React.createElement("p", {
    key: j,
    style: {
      margin: j ? '12px 0 0' : 0
    }
  }, p))) : null)))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      padding: '0 var(--pad-content) 18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 720,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement(InputDock, {
    value: draft,
    onChange: setDraft,
    onSubmit: onSend,
    contextPercent: 42
  }))));
}
Object.assign(window, {
  ChatScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/toby-app/ChatScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/toby-app/DashboardScreen.jsx
try { (() => {
const {
  DashboardCard,
  CardSection,
  FlowRunnerCard,
  OnboardingTile,
  IconButton,
  ProgressBar,
  Skeleton
} = window.TobyDesignSystem_28de33;
function OnboardingBlock() {
  const steps = window.TobyKitData.onboarding;
  const done = steps.filter(s => s.complete).length;
  return /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 26,
      borderRadius: 'var(--radius-lg)',
      background: 'var(--surface-panel)',
      position: 'relative',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: 26,
      right: 26,
      top: 0,
      height: 2,
      background: 'var(--toby-accent)',
      opacity: 0.85
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--size-card-title)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-body)'
    }
  }, "Finish setting up Toby"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--size-row-title)',
      fontWeight: 'var(--weight-medium)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-accent)'
    }
  }, done), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, ' of ' + steps.length + ' done'))), /*#__PURE__*/React.createElement(ProgressBar, {
    progress: done / steps.length
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 'var(--gap-tile)',
      marginTop: 18
    }
  }, steps.map(s => /*#__PURE__*/React.createElement(OnboardingTile, {
    key: s.title,
    title: s.title,
    subtitle: s.subtitle,
    glyph: /*#__PURE__*/React.createElement(Icon, {
      name: s.icon,
      size: 15
    }),
    actionLabel: s.action,
    upNext: s.upNext,
    complete: s.complete
  }))));
}
function DashboardScreen({
  refreshing,
  onRefresh
}) {
  const blocks = window.TobyKitData.blocks;
  const [running, setRunning] = React.useState(false);
  const runFlow = () => {
    setRunning(true);
    setTimeout(() => setRunning(false), 1400);
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      overflow: 'auto',
      padding: 'var(--pad-content)',
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement(OnboardingBlock, null), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
      gap: 20,
      alignItems: 'start'
    }
  }, blocks.map(b => /*#__PURE__*/React.createElement(DashboardCard, {
    key: b.id,
    title: b.title,
    lastRan: b.ranAt.split(' ')[1],
    showMore: b.sections.length > 2,
    stamp: /*#__PURE__*/React.createElement(Icon, {
      name: b.icon,
      size: 120
    }),
    actions: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(IconButton, {
      label: "Refresh",
      filled: false,
      tone: "faint",
      size: "sm",
      glyph: /*#__PURE__*/React.createElement(Icon, {
        name: "refresh-cw",
        size: 11
      }),
      onClick: () => onRefresh(b.id)
    }), /*#__PURE__*/React.createElement(IconButton, {
      label: "Actions",
      filled: false,
      tone: "faint",
      size: "sm",
      glyph: /*#__PURE__*/React.createElement(Icon, {
        name: "ellipsis",
        size: 11
      })
    }))
  }, refreshing === b.id ? /*#__PURE__*/React.createElement(Skeleton, {
    lines: 4
  }) : b.sections.map(s => /*#__PURE__*/React.createElement(CardSection, {
    key: s.h,
    label: s.h
  }, s.p)))), /*#__PURE__*/React.createElement("div", {
    style: {
      minHeight: 'var(--dashboard-card-collapsed)'
    }
  }, /*#__PURE__*/React.createElement(FlowRunnerCard, {
    title: "Weekly review",
    stamp: /*#__PURE__*/React.createElement(Icon, {
      name: "git-branch",
      size: 120
    }),
    running: running,
    onRun: runFlow,
    description: "Collects last week's shipped work, open tasks, and calendar into one summary you can paste into a status update."
  }))));
}
Object.assign(window, {
  DashboardScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/toby-app/DashboardScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/toby-app/IntegrationsScreen.jsx
try { (() => {
const {
  SettingsCard,
  SettingsRow,
  SettingsSectionHeader,
  Button,
  InlineStatusMessage,
  Chip,
  Toggle,
  Select
} = window.TobyDesignSystem_28de33;
function IntegrationsScreen({
  selected,
  onSelect
}) {
  const list = window.TobyKitData.integrations;
  const item = list.find(i => i.id === selected) || list[0];
  const tone = item.status === 'Connected' ? 'success' : 'error';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      display: 'flex',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 240,
      flexShrink: 0,
      borderRight: '1px solid var(--border-hairline)',
      padding: '12px 8px',
      overflow: 'auto'
    }
  }, list.map(i => /*#__PURE__*/React.createElement("button", {
    key: i.id,
    type: "button",
    onClick: () => onSelect(i.id),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      width: '100%',
      textAlign: 'left',
      padding: '8px 10px',
      border: 'none',
      borderRadius: 'var(--radius-row)',
      cursor: 'pointer',
      background: i.id === item.id ? 'var(--surface-selected-strong)' : 'transparent'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: '../../assets/icons/integrations/' + i.id + '.png',
    alt: "",
    width: "20",
    height: "20",
    style: {
      objectFit: 'contain'
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--size-callout)',
      fontWeight: 'var(--weight-medium)',
      color: 'var(--text-body)'
    }
  }, i.label)))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: 'auto',
      padding: 'var(--pad-content)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--settings-content-max)',
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: '../../assets/icons/integrations/' + item.id + '.png',
    alt: "",
    width: "40",
    height: "40",
    style: {
      objectFit: 'contain'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--size-title2)',
      fontWeight: 'var(--weight-semibold)',
      color: 'var(--text-body)'
    }
  }, item.label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--size-subheadline)',
      color: 'var(--text-muted)'
    }
  }, '@toby/plugin-' + item.id)), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(Button, null, item.status === 'Connected' ? 'Reconnect' : 'Connect')), /*#__PURE__*/React.createElement(InlineStatusMessage, {
    tone: tone,
    message: item.status === 'Connected' ? 'Connected. Last sync 4 minutes ago.' : 'Not connected yet. Run the setup wizard to add credentials.'
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--size-card-body)',
      color: 'var(--text-muted)',
      lineHeight: 1.6,
      textWrap: 'pretty'
    }
  }, item.summary), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SettingsSectionHeader, null, "Tools exposed to chat"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, item.tools.map(t => /*#__PURE__*/React.createElement(Chip, {
    key: t,
    label: t
  })))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SettingsSectionHeader, null, "Configuration"), /*#__PURE__*/React.createElement(SettingsCard, null, /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Enabled",
    description: "Turn the integration off without removing credentials."
  }, /*#__PURE__*/React.createElement(Toggle, {
    checked: item.status === 'Connected',
    label: "Enabled"
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Sync interval",
    description: "How often background flows refresh this source."
  }, /*#__PURE__*/React.createElement(Select, {
    value: "15",
    options: [{
      value: '5',
      label: 'Every 5 minutes'
    }, {
      value: '15',
      label: 'Every 15 minutes'
    }, {
      value: '60',
      label: 'Hourly'
    }]
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Setup guide",
    description: "Open the help site page for this integration.",
    showsDivider: false
  }, /*#__PURE__*/React.createElement(Button, {
    external: true
  }, "Open guide")))))));
}
Object.assign(window, {
  IntegrationsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/toby-app/IntegrationsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/toby-app/SettingsScreen.jsx
try { (() => {
const {
  SettingsCard,
  SettingsRow,
  SettingsSectionHeader,
  Toggle,
  Select,
  TextField,
  Button,
  Badge
} = window.TobyDesignSystem_28de33;
const settingsTabs = [{
  id: 'general',
  label: 'General',
  icon: 'settings-2'
}, {
  id: 'appearance',
  label: 'Appearance',
  icon: 'palette'
}, {
  id: 'ai',
  label: 'AI providers',
  icon: 'sparkles'
}, {
  id: 'personas',
  label: 'Personas',
  icon: 'user-round'
}, {
  id: 'sync',
  label: 'iCloud sync',
  icon: 'cloud'
}];
function SettingsScreen({
  theme,
  setTheme,
  accent,
  setAccent,
  tab,
  setTab
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      height: '100%',
      display: 'flex',
      background: 'var(--surface-settings-canvas)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 210,
      flexShrink: 0,
      borderRight: '1px solid var(--border-hairline)',
      padding: '12px 8px'
    }
  }, settingsTabs.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    type: "button",
    onClick: () => setTab(t.id),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      textAlign: 'left',
      padding: '7px 10px',
      border: 'none',
      borderRadius: 'var(--radius-row)',
      cursor: 'pointer',
      marginBottom: 2,
      background: tab === t.id ? 'var(--surface-selected-strong)' : 'transparent',
      color: tab === t.id ? 'var(--text-body)' : 'var(--text-muted)',
      fontSize: 'var(--size-callout)'
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    name: t.icon,
    size: 14
  }), t.label))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: 'auto',
      padding: 'var(--pad-content)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 'var(--settings-content-max)',
      display: 'flex',
      flexDirection: 'column',
      gap: 20
    }
  }, tab === 'appearance' ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SettingsSectionHeader, null, "Theme"), /*#__PURE__*/React.createElement(SettingsCard, null, /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Appearance",
    description: "Follow the system setting or pin light / dark."
  }, /*#__PURE__*/React.createElement(Select, {
    value: theme,
    onChange: setTheme,
    options: [{
      value: 'system',
      label: 'System'
    }, {
      value: 'light',
      label: 'Light'
    }, {
      value: 'dark',
      label: 'Dark'
    }]
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Accent color",
    description: "Tints selection, highlights, and the send button.",
    showsDivider: false
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6
    }
  }, ['orange', 'blue', 'green', 'purple', 'pink', 'red', 'teal', 'gray'].map(a => /*#__PURE__*/React.createElement("button", {
    key: a,
    type: "button",
    "aria-label": a,
    title: a,
    onClick: () => setAccent(a),
    style: {
      width: 18,
      height: 18,
      borderRadius: 999,
      cursor: 'pointer',
      background: 'var(--toby-accent-' + a + ')',
      border: accent === a ? '2px solid var(--text-body)' : '1px solid var(--border-control)'
    }
  })))))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SettingsSectionHeader, null, "Chat"), /*#__PURE__*/React.createElement(SettingsCard, null, /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Transcript detail",
    description: "Debug shows tools, prep, and selection notices."
  }, /*#__PURE__*/React.createElement(Select, {
    value: "normal",
    options: [{
      value: 'normal',
      label: 'Normal'
    }, {
      value: 'debug',
      label: 'Debug'
    }]
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Show dashboard onboarding",
    showsDivider: false
  }, /*#__PURE__*/React.createElement(Toggle, {
    checked: true,
    label: "Show onboarding"
  }))))) : tab === 'ai' ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SettingsSectionHeader, null, "Default provider"), /*#__PURE__*/React.createElement(SettingsCard, null, /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Provider",
    description: "Used by chat, dashboard summaries, and schedules."
  }, /*#__PURE__*/React.createElement(Select, {
    value: "openai",
    options: [{
      value: 'openai',
      label: 'OpenAI'
    }, {
      value: 'ollama',
      label: 'Ollama (local)'
    }, {
      value: 'openrouter',
      label: 'OpenRouter'
    }, {
      value: 'vercel',
      label: 'Vercel AI Gateway'
    }]
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Model",
    description: "Reasoning models are marked in the list."
  }, /*#__PURE__*/React.createElement(Select, {
    value: "gpt-4.1",
    options: [{
      value: 'gpt-4.1',
      label: 'gpt-4.1'
    }, {
      value: 'gpt-4.1-mini',
      label: 'gpt-4.1-mini'
    }, {
      value: 'o4-mini',
      label: 'o4-mini · reasoning'
    }]
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    title: "API key",
    description: "Stored in the macOS keychain, never in config.json.",
    showsDivider: false
  }, /*#__PURE__*/React.createElement(TextField, {
    secure: true,
    value: "sk-live-8f21",
    placeholder: "sk-\u2026"
  })))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SettingsSectionHeader, null, "Providers"), /*#__PURE__*/React.createElement(SettingsCard, null, [['openai', 'OpenAI', 'Configured'], ['ollama', 'Ollama', 'Local · llama3.1'], ['openrouter', 'OpenRouter', 'Not configured'], ['vercel', 'Vercel AI Gateway', 'Not configured']].map((p, i, arr) => /*#__PURE__*/React.createElement(SettingsRow, {
    key: p[0],
    title: p[1],
    description: p[2],
    showsDivider: i < arr.length - 1
  }, /*#__PURE__*/React.createElement("img", {
    src: '../../assets/icons/ai/' + p[0] + '.png',
    alt: "",
    width: "22",
    height: "22",
    style: {
      objectFit: 'contain'
    }
  }), /*#__PURE__*/React.createElement(Button, null, "Configure")))))) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SettingsSectionHeader, null, "Startup"), /*#__PURE__*/React.createElement(SettingsCard, null, /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Open Toby at login",
    description: "Starts the app and daemon when this Mac logs in."
  }, /*#__PURE__*/React.createElement(Toggle, {
    label: "Launch at login"
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Show menu bar icon",
    description: "Keep Toby reachable without the main window."
  }, /*#__PURE__*/React.createElement(Toggle, {
    checked: true,
    label: "Menu bar icon"
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Global shortcut",
    description: "Opens the command palette from anywhere.",
    showsDivider: false
  }, /*#__PURE__*/React.createElement(Badge, null, "\u2325 Space")))), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(SettingsSectionHeader, null, "Data"), /*#__PURE__*/React.createElement(SettingsCard, null, /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Toby directory",
    description: "Config, sessions, memories, and plugins live here."
  }, /*#__PURE__*/React.createElement(TextField, {
    value: "~/.toby",
    maxWidth: 200
  })), /*#__PURE__*/React.createElement(SettingsRow, {
    title: "Backup",
    description: "Write an encrypted archive of config and credentials.",
    showsDivider: false
  }, /*#__PURE__*/React.createElement(Button, null, "Back up now"))))))));
}
Object.assign(window, {
  SettingsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/toby-app/SettingsScreen.jsx", error: String((e && e.message) || e) }); }

// ui_kits/toby-app/Sidebar.jsx
try { (() => {
const {
  SidebarSection,
  SidebarRow,
  SidebarActionGrid,
  PersonaFooter
} = window.TobyDesignSystem_28de33;
const Icon = ({
  name,
  size = 16
}) => /*#__PURE__*/React.createElement("i", {
  "data-lucide": name,
  style: {
    width: size,
    height: size,
    display: 'inline-flex'
  }
});
function ServerStatusButton() {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    title: "Server running \xB7 daemon healthy",
    "aria-label": "Server status",
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      color: 'var(--text-faint)',
      fontSize: 'var(--size-caption)',
      padding: '4px 6px',
      borderRadius: 'var(--radius-xs)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 7,
      height: 7,
      borderRadius: 999,
      background: 'var(--control-toggle-on)'
    }
  }), /*#__PURE__*/React.createElement("span", null, "Running"));
}
function TobySidebar({
  route,
  onRoute,
  sessions,
  activeSession,
  onSession,
  personaOpen,
  onPersona
}) {
  const data = window.TobyKitData;
  const items = data.routes.map(r => ({
    id: r.id,
    title: r.title,
    color: r.color,
    glyph: /*#__PURE__*/React.createElement(Icon, {
      name: r.icon,
      size: 18
    })
  }));
  const listFor = {
    chat: {
      title: 'Chats',
      rows: sessions.map(s => ({
        id: s.id,
        title: s.title,
        subtitle: s.subtitle,
        glyph: s.img ? /*#__PURE__*/React.createElement("img", {
          src: '../../assets/icons/integrations/' + s.img + '.png',
          alt: "",
          width: "16",
          height: "16"
        }) : /*#__PURE__*/React.createElement(Icon, {
          name: s.icon
        }),
        trailing: s.awaiting ? /*#__PURE__*/React.createElement(Icon, {
          name: "message-circle-question",
          size: 12
        }) : null
      }))
    },
    integrations: {
      title: 'Connected',
      rows: data.integrations.map(i => ({
        id: i.id,
        title: i.label,
        subtitle: i.status,
        glyph: /*#__PURE__*/React.createElement("img", {
          src: '../../assets/icons/integrations/' + i.id + '.png',
          alt: "",
          width: "16",
          height: "16"
        })
      }))
    },
    dashboard: {
      title: 'Home',
      rows: data.blocks.map(b => ({
        id: b.id,
        title: b.title,
        subtitle: 'Flow block',
        glyph: /*#__PURE__*/React.createElement(Icon, {
          name: b.icon
        })
      }))
    }
  }[route] || {
    title: 'Recent',
    rows: sessions.slice(0, 3).map(s => ({
      id: s.id,
      title: s.title,
      subtitle: s.subtitle,
      glyph: /*#__PURE__*/React.createElement(Icon, {
        name: "message-square"
      })
    }))
  };
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 'var(--sidebar-width)',
      flexShrink: 0,
      background: 'var(--surface-sidebar)',
      padding: 'var(--pad-sidebar-y) var(--pad-sidebar-x)',
      display: 'flex',
      flexDirection: 'column',
      boxSizing: 'border-box'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '0 8px 14px'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/toby-128.png",
    alt: "",
    width: "33",
    height: "33"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--size-wordmark)',
      fontWeight: 'var(--weight-bold)',
      color: 'var(--text-body)',
      lineHeight: 1.1
    }
  }, "TOBY"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 'var(--size-caption)',
      color: 'var(--text-faint)'
    }
  }, "v1.42.0")), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(ServerStatusButton, null)), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      overflow: 'auto',
      paddingBottom: 16
    }
  }, /*#__PURE__*/React.createElement(SidebarSection, {
    title: listFor.title
  }, listFor.rows.map(r => /*#__PURE__*/React.createElement(SidebarRow, {
    key: r.id,
    title: r.title,
    subtitle: r.subtitle,
    glyph: r.glyph,
    trailing: r.trailing,
    selected: r.id === activeSession,
    onClick: () => onSession(r.id)
  })))), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: 'var(--border-hairline)',
      opacity: 0.5
    }
  }), /*#__PURE__*/React.createElement(SidebarActionGrid, {
    items: items,
    selectedId: route,
    onSelect: onRoute
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: 'var(--border-hairline)',
      opacity: 0.5
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      paddingTop: 8
    }
  }, /*#__PURE__*/React.createElement(PersonaFooter, {
    name: "Toby",
    model: "gpt-4.1 \xB7 openai",
    imageSrc: "../../assets/personas/toby.png",
    open: personaOpen,
    onClick: onPersona
  })));
}
Object.assign(window, {
  TobySidebar,
  Icon
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/toby-app/Sidebar.jsx", error: String((e && e.message) || e) }); }

// ui_kits/toby-app/data.js
try { (() => {
window.TobyKitData = {
  sessions: [{
    id: 's1',
    title: 'Weekly review prep',
    subtitle: '4 messages',
    icon: 'message-square'
  }, {
    id: 's2',
    title: 'Jira triage',
    subtitle: '11:20',
    img: 'jira'
  }, {
    id: 's3',
    title: 'Inbox digest',
    subtitle: 'Awaiting reply',
    img: 'email',
    awaiting: true
  }, {
    id: 's4',
    title: 'Renewal thread',
    subtitle: 'Yesterday',
    icon: 'message-square'
  }, {
    id: 's5',
    title: 'Standup notes from Tuesday',
    subtitle: 'Aug 19',
    icon: 'message-square'
  }],
  routes: [{
    id: 'dashboard',
    title: 'Dashboard',
    icon: 'layout-grid',
    color: 'var(--toby-route-dashboard)',
    detail: 'See what needs your attention: unread mail, open tasks, and setup steps at a glance.'
  }, {
    id: 'chat',
    title: 'Chats',
    icon: 'message-square',
    color: 'var(--toby-route-chats)',
    detail: 'Open your chat workspace, continue existing conversations, or start a new session with Toby.'
  }, {
    id: 'integrations',
    title: 'Integrations',
    icon: 'grid-2x2',
    color: 'var(--toby-route-integrations)',
    detail: 'Manage connected services, credentials, setup guides, and integration-specific capabilities.'
  }, {
    id: 'projects',
    title: 'Projects',
    icon: 'folder',
    color: 'var(--toby-route-projects)',
    detail: 'Work inside project folders with scoped chats, local guidance, skills, and generated outputs.'
  }, {
    id: 'skills',
    title: 'Skills',
    icon: 'sparkles',
    color: 'var(--toby-route-skills)',
    detail: 'Browse installed skills, inspect their instructions, edit them, or add new reusable workflows.'
  }, {
    id: 'memories',
    title: 'Memories',
    icon: 'brain',
    color: 'var(--toby-route-memories)',
    detail: 'Browse, create, edit, and delete memories Toby remembers across chats and automations.'
  }, {
    id: 'schedules',
    title: 'Schedules',
    icon: 'clock',
    color: 'var(--toby-route-schedules)',
    detail: "Create and monitor recurring prompts that run on a schedule through Toby's background daemon."
  }, {
    id: 'flows',
    title: 'Flows',
    icon: 'git-branch',
    color: 'var(--toby-route-flows)',
    detail: 'Browse named flow pipelines, inspect their nodes, and review recent execution history.'
  }, {
    id: 'recordings',
    title: 'Recordings',
    icon: 'audio-lines',
    color: 'var(--toby-route-recordings)',
    detail: 'Review audio recordings, transcripts, and chats created from recorded context.'
  }],
  suggestions: [{
    text: 'Show me today’s calendar and conflicts',
    icon: 'calendar'
  }, {
    text: 'Summarize unread mail that needs a reply',
    icon: 'mail'
  }, {
    text: 'Create a recurring schedule for my weekly review',
    icon: 'clock'
  }, {
    text: 'Find open tasks that are blocked or stale',
    icon: 'list-checks'
  }, {
    text: 'Turn on Focus and minimize distracting windows',
    icon: 'app-window'
  }],
  integrations: [{
    id: 'email',
    label: 'Email',
    status: 'Connected',
    summary: 'IMAP + SMTP for one mailbox. Toby can search, summarize, draft, and send.',
    tools: ['search_mail', 'read_thread', 'draft_reply', 'send_mail']
  }, {
    id: 'todoist',
    label: 'Todoist',
    status: 'Connected',
    summary: 'Read and write tasks, projects, and due dates from chat.',
    tools: ['list_tasks', 'create_task', 'complete_task']
  }, {
    id: 'slack',
    label: 'Slack',
    status: 'Connected',
    summary: 'Read channels Toby is invited to, and answer @mentions as an inbound chat surface.',
    tools: ['list_channels', 'read_messages', 'post_message']
  }, {
    id: 'jira',
    label: 'Jira',
    status: 'Needs setup',
    summary: 'Track issues assigned to you, move tickets, and summarize sprint state.',
    tools: ['search_issues', 'transition_issue']
  }, {
    id: 'notion',
    label: 'Notion',
    status: 'Not connected',
    summary: 'Search pages and databases, append notes to a daily page.',
    tools: ['search_pages', 'append_block']
  }, {
    id: 'apple-calendar',
    label: 'Apple Calendar',
    status: 'Connected',
    summary: 'Native EventKit access to local calendars — no cloud round trip.',
    tools: ['list_events', 'create_event']
  }, {
    id: 'apple-reminders',
    label: 'Apple Reminders',
    status: 'Connected',
    summary: 'Read and create reminders in local lists.',
    tools: ['list_reminders', 'create_reminder']
  }, {
    id: 'macos',
    label: 'macOS',
    status: 'Connected',
    summary: 'Focus modes, window control, screenshots, and bundled Shortcuts.',
    tools: ['set_focus', 'run_shortcut', 'window_control']
  }],
  blocks: [{
    id: 'mail',
    title: 'Unread mail',
    icon: 'mail',
    ranAt: '8/24/26 07:15',
    sections: [{
      h: 'Needs attention',
      p: 'Priya asked for the signed renewal before Friday — the thread has been open since Thursday and nobody has replied.'
    }, {
      h: 'Worth noting',
      p: 'Two CI failure digests, and a design-review invite for Thursday that conflicts with your 1:1.'
    }, {
      h: 'Ignore',
      p: 'Nine newsletters and three receipts.'
    }]
  }, {
    id: 'tasks',
    title: 'Open tasks',
    icon: 'list-checks',
    ranAt: '8/24/26 07:15',
    sections: [{
      h: 'Overdue',
      p: 'Ship the plugin protocol doc (2 days late) and reply to the vendor security questionnaire.'
    }, {
      h: 'Due today',
      p: 'Review the transcription settings PR, then write the weekly summary.'
    }, {
      h: 'Stale',
      p: 'Four tasks have not moved in three weeks — most are blocked on the daemon rewrite.'
    }]
  }, {
    id: 'calendar',
    title: 'Upcoming events',
    icon: 'calendar',
    ranAt: '8/24/26 07:15',
    sections: [{
      h: 'Today',
      p: '10:00 Standup · 13:30 Design review · 16:00 1:1 with Priya (overlaps the review).'
    }, {
      h: 'Tomorrow',
      p: 'Two blocks of focus time and a vendor call at 15:00.'
    }]
  }],
  onboarding: [{
    title: 'Set up AI',
    subtitle: 'Provider and model chosen.',
    icon: 'sparkles',
    complete: true
  }, {
    title: 'Connect an integration',
    subtitle: 'Email, Slack, Jira, Todoist, or Apple Calendar.',
    icon: 'grid-2x2',
    action: 'Connect',
    upNext: true
  }, {
    title: 'Create a persona',
    subtitle: 'Shape how Toby prioritizes and responds.',
    icon: 'user-round',
    action: 'Create'
  }, {
    title: 'Add a schedule',
    subtitle: 'Run a prompt every morning.',
    icon: 'clock',
    action: 'Create'
  }, {
    title: 'Record your first note',
    subtitle: 'Listen mode transcribes locally.',
    icon: 'audio-lines',
    action: 'Open Listen'
  }, {
    title: 'Grant permissions',
    subtitle: 'Calendar, Contacts, microphone, automation.',
    icon: 'shield-check',
    action: 'Review'
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/toby-app/data.js", error: String((e && e.message) || e) }); }

__ds_ns.AssistantMessage = __ds_scope.AssistantMessage;

__ds_ns.InputDock = __ds_scope.InputDock;

__ds_ns.UserMessage = __ds_scope.UserMessage;

__ds_ns.WorkStepRow = __ds_scope.WorkStepRow;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Chip = __ds_scope.Chip;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.ProgressBar = __ds_scope.ProgressBar;

__ds_ns.DashboardCard = __ds_scope.DashboardCard;

__ds_ns.CardSection = __ds_scope.CardSection;

__ds_ns.FlowRunnerCard = __ds_scope.FlowRunnerCard;

__ds_ns.OnboardingTile = __ds_scope.OnboardingTile;

__ds_ns.InlineStatusMessage = __ds_scope.InlineStatusMessage;

__ds_ns.Skeleton = __ds_scope.Skeleton;

__ds_ns.Toast = __ds_scope.Toast;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.SettingsCard = __ds_scope.SettingsCard;

__ds_ns.SettingsRow = __ds_scope.SettingsRow;

__ds_ns.SettingsSectionHeader = __ds_scope.SettingsSectionHeader;

__ds_ns.TextField = __ds_scope.TextField;

__ds_ns.Toggle = __ds_scope.Toggle;

__ds_ns.PersonaFooter = __ds_scope.PersonaFooter;

__ds_ns.SidebarActionGrid = __ds_scope.SidebarActionGrid;

__ds_ns.SidebarRow = __ds_scope.SidebarRow;

__ds_ns.SidebarSection = __ds_scope.SidebarSection;

})();
