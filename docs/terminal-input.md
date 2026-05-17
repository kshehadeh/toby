# Terminal input handling

Toby's chat input is a React/Ink TUI that reads raw terminal events via Ink's `useInput` hook. Because terminals encode modified key presses differently (and sometimes unreliably), Toby has a layered detection system. This document explains how it works so that future shortcut key additions can be implemented smoothly.

## Architecture overview

```
Terminal raw bytes
    │
    ▼
Ink parse-keypress (node_modules/ink/build/parse-keypress.js)
    │  Parses CSI sequences, Kitty protocol, ESC+letter, etc.
    │  Produces { name, ctrl, meta, shift, sequence, … }
    │
    ▼
Ink useInput hook
    │  Maps ParsedKey → Key { leftArrow, meta, ctrl, shift, … }
    │  Strips ESC prefix from typedInput for non-alphanumeric keys
    │  Calls handler(input, key)
    │
    ▼
useMultilineInput (src/ui/shared/use-multiline-input.ts)
    │  Main input handler; decides what each (typedInput, key) pair means
    │
    ├── resolveDeleteShortcutAction (src/ui/chat/input-keymap.ts)
    │     Maps delete/backspace variants → logical actions
    │
    └── resolveWordNavigationAction (src/ui/chat/input-keymap.ts)
          Maps Meta+Arrow and ESC+b/f → word navigation actions
```

Supporting modules:

| Module | Role |
| ------ | ---- |
| `src/ui/shared/terminal-profile.ts` | Detects terminal type from `TERM_PROGRAM`/`TERM`; records which modifier encodings each terminal supports (Kitty, ESC+letter, Ctrl fallback, etc.) |
| `src/ui/chat/input-keymap.ts` | Pure functions that map `(typedInput, key)` → logical actions; no React state |
| `src/ui/chat/input-cursor.ts` | `reconcileCursorIndex` — clamps cursor after value changes |

## The encoding problem

Terminals do not have a single, universal way to report modified key presses. The three encoding families are:

### 1. Kitty keyboard protocol (CSI u)

Modern terminals (Kitty, WezTerm, Ghostty, iTerm2, foot, Warp, Tabby) support the [Kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/). When active:

- Every key press is encoded as `\x1b[codepoint;modifiers u` or `\x1b[number;modifiers:eventType letter`.
- Ink's `parseKeypress` parses these directly and sets `key.ctrl`, `key.meta`, `key.shift`, `key.super` accurately.
- `key.eventType` is present (`"press"`, `"repeat"`, `"release"`), which Toby uses to detect Kitty activation at runtime.
- Arrow keys, backspace, Enter, etc. all report their logical name (`key.leftArrow`, `key.backspace`, etc.) alongside accurate modifiers.

**When Kitty is active, `key.meta && key.leftArrow` works correctly.**

### 2. CSI modifier sequences (xterm-style)

Many terminals encode modified special keys by adding a modifier parameter to the standard CSI sequence:

| Key | Unmodified | With Meta (Alt) |
| --- | ---------- | --------------- |
| Left | `\x1b[D` | `\x1b[1;3D` |
| Right | `\x1b[C` | `\x1b[1;3C` |
| Delete | `\x1b[3~` | `\x1b[3;3~` |

Ink's `parse-keypress.js` handles these via the `fnKeyRe` regex, which extracts the modifier digit and sets `key.ctrl`/`key.meta`/`key.shift` using bitmask logic (`modifier & 4` for ctrl, `modifier & 10` for meta, `modifier & 1` for shift).

**When CSI modifier sequences are used, `key.meta && key.leftArrow` also works correctly.**

### 3. ESC + letter (macOS "Option as +Esc")

This is the default mode on macOS terminals (iTerm2, Apple Terminal). When the user presses Option (Alt) + another key, the terminal sends ESC (`\x1b`) followed by a letter:

| User action | Bytes sent | Ink parses as |
| ----------- | ---------- | ------------- |
| Option+Left | `\x1bb` | `key.meta=true, typedInput="b", key.leftArrow=false` |
| Option+Right | `\x1bf` | `key.meta=true, typedInput="f", key.rightArrow=false` |
| Option+Delete | `\x1b\x7f` | `key.meta=true, key.backspace=true` |
| Option+Enter | `\x1b\r` | `key.meta=true, key.return=true` |

Ink's `metaKeyCodeRe` regex (`/^(?:\x1b)([a-zA-Z0-9])$/`) matches these and sets `key.meta=true`. The trailing letter appears in `typedInput` (after Ink strips the ESC prefix).

**Critical: `key.leftArrow` / `key.rightArrow` are NOT set for ESC+letter sequences.** The handler must check `key.meta && typedInput === "b"` (not `key.leftArrow`) to detect Option+Left.

## Decision flow in useMultilineInput

The `useInput` handler processes events in this order (early return on match):

1. **Debug logging** (if `DEBUG_INPUT` env is set)
2. **Kitty protocol detection** — first event with `key.eventType` promotes profile
3. **Pending backslash flush** — clears the Shift+Enter timer
4. **Shift+Enter heuristics** — single-event `\\\r` and pending-backslash patterns
5. **Enter handling** — submit vs. newline mode
6. **Stray newline/CR** — ignored
7. **Raw control character guard** — `\x03` (Ctrl+C), `\x04` (Ctrl+D), `\x15` (Ctrl+U), `\x17` (Ctrl+W) are ignored to prevent raw bytes from being inserted
8. **Tab / Ctrl+C** — ignored
9. **Arrow up/down** — multi-line row navigation
10. **Word navigation** (`resolveWordNavigationAction`) — Meta+Arrow (CSI) or Meta+b/f (ESC+letter)
11. **Arrow left/right** — single character movement
12. **Ctrl+W** — word-delete fallback
13. **Delete action** (`resolveDeleteShortcutAction`) — Meta+Backspace, plain Backspace, etc.
14. **Character insertion** — pending-backslash heuristic, then `insertAtCursor(typedInput)`

**Order matters**: word navigation (step 10) must precede plain arrow keys (step 11) so Meta+Arrow isn't consumed as a plain arrow. It must also precede character insertion (step 14) so ESC+b/f isn't inserted as a literal "b"/"f" character.

## Adding a new keyboard shortcut

For **view-level** shortcuts (navigate, select, back, quit, confirm, cancel, toggle, save), prefer the shared predicates in `src/ui/shared/keybindings.ts` (see [`docs/ui.md`](ui.md)). Only add new low-level resolvers here when the shortcut involves terminal-specific modifier encoding.

### Step 1: Determine the encoding

Ask: how will each terminal family encode this key?

| Terminal family | Encoding | What Ink reports |
| --------------- | -------- | ---------------- |
| Kitty protocol | CSI u | `key.meta`/`key.ctrl`/`key.shift` + correct `key.*Arrow`/`key.backspace`/etc. |
| xterm CSI modifiers | `\x1b[1;N<letter>` | Same as Kitty: modifiers + arrow booleans |
| macOS "Option as +Esc" | `\x1b<letter>` | `key.meta=true`, `typedInput="<letter>"`, arrow/special booleans are **false** |

If the shortcut involves a modified special key (arrow, backspace, Enter, etc.), you likely need **two checks**: one for the CSI/Kitty encoding (which sets the boolean) and one for the ESC+letter encoding (which sets `typedInput`).

Use `DEBUG_INPUT=/tmp/toby-input.log toby chat` to see exactly what Ink reports for any key press on your terminal.

### Step 2: Add a resolver function to input-keymap.ts

Follow the pattern of `resolveWordNavigationAction` and `resolveDeleteShortcutAction`:

```ts
export function resolveMyShortcutAction(
  typedInput: string,
  key: Key,
): MyShortcutAction {
  // Kitty / CSI-modified: modifier boolean + special-key boolean
  if (key.meta && key.upArrow) return "my-action";
  // ESC+letter: modifier boolean + typedInput letter
  if (key.meta && typedInput === "p") return "my-action";
  return "none";
}
```

Keep the resolver pure (no React state, no side effects). This makes it easy to unit-test.

### Step 3: Handle the action in useMultilineInput

Insert the check at the right point in the handler's decision chain. Place it **before** any broader catch-all that would otherwise consume the event (e.g., before plain arrow-key handling, before character insertion).

### Step 4: Add the mode to TerminalProfile (optional)

If the shortcut has a terminal-specific fallback (like Ctrl+W for word-delete), add a mode type and per-terminal values to `terminal-profile.ts`. This lets the slash-commands `/terminal` command report support and helps future maintainers understand the fallback chain.

### Step 5: Add tests

Tests for `input-keymap.ts` functions use a `mkKey()` helper that constructs a `Key` object with all booleans defaulting to `false`. Test:

- The Kitty/CSI path (modifier boolean + key boolean)
- The ESC+letter path (modifier boolean + typedInput letter)
- Negative cases (plain key without modifier)

## Quick reference: ESC+letter codes on macOS

These are the letters macOS terminals send with "Option as +Esc" active:

| Key | ESC code | `typedInput` | Notes |
| --- | -------- | ------------ | ----- |
| Option+Left | `\x1bb` | `b` | Emacs backward-word |
| Option+Right | `\x1bf` | `f` | Emacs forward-word |
| Option+Delete | `\x1b\x7f` | *(empty)* | Ink sets `key.backspace=true` + `key.meta=true` |
| Option+Backspace | `\x1b\x7f` | *(empty)* | Same as Option+Delete |
| Option+Enter | `\x1b\r` | *(empty)* | Ink sets `key.return=true` + `key.meta=true` |

Note: Option+Delete and Option+Enter produce two-byte sequences where the second byte is a control character, not a printable letter. Ink handles these as modified special keys (setting both the key boolean and `key.meta`), so no `typedInput` check is needed — the `key.meta && key.backspace` / `key.meta && key.return` check works across all encoding families.

## Debugging

Set `DEBUG_INPUT=/tmp/toby-input.log toby chat` to log every `(typedInput, key)` event. The log includes `typed`, `ret`, `shift`, `ctrl`, `meta`, `evtType`, `up`, `down` fields. This is the fastest way to discover what your terminal actually sends for a given key combination.

Use `/terminal` inside `toby chat` to see the detected terminal profile, Kitty protocol status, and supported input modes.
