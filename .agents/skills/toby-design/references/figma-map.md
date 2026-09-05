# Figma-to-native map

The Figma file **Toby Design System** is a library catalog and visual review
artifact. It is not the authority for production implementation.

| Figma page | Native contract/source |
| --- | --- |
| `01 Foundations` | `DESIGN.md` foundations and `UI/Theme/{AppTheme,SettingsDesign,NSColor+TobyTheme}.swift` |
| `02 Components` | `component-recipes.md`; `UI/Primitives`, `UI/SettingsControls`, and feature component families |
| `03 App layouts` | `screen-patterns.md`; Dashboard, Chat, Integrations, and Configure source families |

## Figma Variables

- `Toby / Color / Light`
- `Toby / Color / Dark`
- `Toby / Accent`
- `Toby / Dimensions`

They are a visual token set. SwiftUI resolves equivalent values through dynamic
AppKit colors and `AppTheme`/`SettingsDesign`; do not add a second runtime token
system.

## Native component catalog

Figma represents 26 named families: Core (Button, Icon button, Badge, Chip,
Progress); Settings forms (card, row, section header, field, select, toggle);
Feedback (status, toast, skeleton); Navigation (section, row, action grid,
persona footer); Chat (dock, user/assistant message, work step); Dashboard
(card, card section, flow runner, onboarding tile).

Button and Badge have native Figma variant sets. Other catalog items are
Auto Layout components where useful. Their constraints, source code, and states
may be richer than their sample Figma content.

## Current limits

- Reference screens can contain editable vectors and simplified layout
  composition, not full production state machines.
- Figma does not encode SwiftUI focus, menu, file importer, virtualized
  transcript scrolling, async ownership, AppKit panel behavior, or
  accessibility identifiers.
- Figma should be updated after a reusable component changes, but source wins
  if the file is not yet synchronized.
