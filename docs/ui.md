# Ink UI conventions

Toby's interactive views use Ink/React. New views should compose the shared primitives in `src/ui/shared/` instead of creating local frame, modal, row, key, or glyph helpers.

## Shared primitives

| Primitive | Use |
| --- | --- |
| `ViewFrame` | Standalone app frame for full-screen views such as schedules, config, and skills. |
| `ViewModal` | Rounded overlay frame for chat pickers and transient modals. |
| `ConfirmDialog` | Confirmation prompt with shared `y/Enter` confirm and `n/Esc` cancel behavior. |
| `MultilineTextEdit` | Text editor for one-line and multi-line form fields. |
| `FieldNavigator` | Breadcrumb field list with `NavigatorRow` rows (configure tree navigation). |
| `FieldEditor` | Full-screen editor overlay for a single text field (Enter/Ctrl+S save, Esc cancel). |
| `FieldSelector` | Full-screen option picker for enum/select fields. |
| `NavigatorRow` | Label + inline value row for editable/selectable fields (personas-style browse). |
| `InfoRow`, `ActionRow`, `SelectableTextRow`, `SectionDivider`, `StatusIcon` | Shared row rendering for lists, details, actions, sections, and statuses. |
| `keybindings.ts` | Named key predicates and standard footer hint strings (`UI_HINTS`). |
| `glyphs.ts` | Shared cursor, section, action, delete, status, checkbox, and plan glyphs. |

## Interaction patterns

### List → field browse

Schedules, skills, and configure use the same high-level flow:

1. **List screen** — `SelectableTextRow` items, `UI_HINTS.list` footer.
2. **Field browse** — `NavigatorRow` (or `FieldNavigator`) shows each field with its current value on the same line. Footer uses `UI_HINTS.fieldBrowse` when the screen supports save (`s`), or `UI_HINTS.detail` for read-only browse.
3. **Edit overlay** — Enter on a text field opens `FieldEditor`; Enter on a select field opens `FieldSelector`.
4. **Actions** — `ActionRow` / delete rows at the bottom of the browse list (run, delete, open in editor, etc.).

Configure additionally nests sections via `FieldNavigator` and saves all credential/persona values on `q` (`UI_HINTS.navigator`).

Do not add a separate “edit screen” that duplicates the field list with `InfoRow` — keep one browse view and overlay editors only.

## Visual conventions

- Full-screen sub-apps use `ViewFrame`: Toby header, single gray border, and optional dim footer.
- Chat overlays use `ViewModal`: rounded border, `ACCENT` border color, and compact rows.
- Selected rows use the shared `› ` cursor and `ACCENT`.
- Section rows use `▸`, action rows use `+`, delete rows use `✕`.
- Statuses use `✔︎`, `✗`, and `…` through `StatusIcon` or `PLAN_STATUS_GLYPHS`.
- Field labels in browse mode use green (unselected) or white bold (selected), with dim inline values — match `NavigatorRow`.

## Shortcut conventions

Use the predicates in `src/ui/shared/keybindings.ts` so shortcuts stay discoverable and consistent.

| Action | Shortcut |
| --- | --- |
| Navigate | `↑` / `↓` |
| Select / edit field | `Enter` |
| Back | `b` / `Backspace` |
| Close app | `q` |
| Confirm | `y` / `Enter` |
| Cancel | `n` / `Esc` |
| Toggle | `Space` |
| Save form | `s` when shown in the footer (`UI_HINTS.fieldBrowse`) |

Editor controls should use `MultilineTextEdit` via `FieldEditor`: one-line fields submit with `Enter`; multiline fields insert new lines with `Enter` and submit with `Ctrl+S`.

## Adding a view

1. Start with `ViewFrame` for standalone views or `ViewModal` for chat overlays.
2. Use `SelectableTextRow` for top-level lists.
3. Use `NavigatorRow` + `FieldEditor` / `FieldSelector` for editable entity detail (personas-style).
4. Handle input through shared key predicates.
5. Put the visible shortcuts in the footer using `UI_HINTS` where possible.
6. Add only view-specific keys when the footer names them.
