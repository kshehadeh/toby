import React from 'react';

// Small inline stand-ins for the SF Symbols the native components use.
// Web only: native work uses the SF Symbol named in each comment.
function G({ size = 14, stroke = 2, children, fill = 'none' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      {children}
    </svg>
  );
}

// arrow.up
export const ArrowUp = (p) => <G {...p}><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></G>;
// plus
export const Plus = (p) => <G {...p}><path d="M12 5v14" /><path d="M5 12h14" /></G>;
// stop.fill
export const Stop = (p) => <G {...p} fill="currentColor" stroke={0}><rect x="6" y="6" width="12" height="12" rx="2" /></G>;
// arrow.clockwise
export const Refresh = (p) => <G {...p}><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v5h-5" /></G>;
// ellipsis
export const Ellipsis = (p) => <G {...p} fill="currentColor" stroke={0}><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></G>;
// chevron.right
export const ChevronRight = (p) => <G {...p}><path d="m9 6 6 6-6 6" /></G>;
// chevron.down
export const ChevronDown = (p) => <G {...p}><path d="m6 9 6 6 6-6" /></G>;
// chevron.up.chevron.down
export const ChevronUpDown = (p) => <G {...p}><path d="m7 9 5-5 5 5" /><path d="m7 15 5 5 5-5" /></G>;
// checkmark.circle.fill
export const CheckCircle = (p) => <G {...p}><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="m8 12 3 3 5-6" stroke="var(--toby-content-bg, #fff)" /></G>;
// exclamationmark.triangle.fill
export const Warning = (p) => <G {...p}><path d="M10.3 3.9 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" fill="currentColor" stroke="none" /><path d="M12 9v4" stroke="var(--toby-content-bg, #fff)" /><path d="M12 17h.01" stroke="var(--toby-content-bg, #fff)" /></G>;
// exclamationmark.circle.fill
export const ErrorCircle = (p) => <G {...p}><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="M12 7v6" stroke="var(--toby-content-bg, #fff)" /><path d="M12 16.5h.01" stroke="var(--toby-content-bg, #fff)" /></G>;
// xmark
export const XMark = (p) => <G {...p}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></G>;
// play.circle
export const PlayCircle = (p) => <G {...p}><circle cx="12" cy="12" r="10" /><path d="m10 8 6 4-6 4Z" /></G>;
// paperclip
export const Paperclip = (p) => <G {...p}><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></G>;
// doc.on.doc
export const Copy = (p) => <G {...p}><rect x="8" y="8" width="13" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></G>;
// slash.circle
export const SlashCircle = (p) => <G {...p}><circle cx="12" cy="12" r="10" /><path d="m5 19 14-14" /></G>;
// arrow.right
export const ArrowRight = (p) => <G {...p}><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></G>;
