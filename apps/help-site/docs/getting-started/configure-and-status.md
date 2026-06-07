---
sidebar_position: 4
title: Configure and connect
---

# Configure and connect integrations

Every integration follows the same pattern: **configure credentials → connect → verify status**.

## 1. Configure credentials

```bash
toby config
```

The configure UI has two panes:

- **Left pane** — expandable settings tree for AI, personas, default providers, integrations, daemon settings, and other sections.
- **Right pane** — details and editable fields for the selected item.

Use arrow keys to navigate, `Enter` to select/edit or expand/collapse, `Tab` to switch panes, `Esc` to move back, `s` to save, and `q` to quit. Toby warns before discarding unsaved edits.

Open **Integrations**, choose a service, and fill in the fields (API keys, OAuth client IDs, and so on). Save when done.

Credentials live in `~/.toby/credentials.json`. Connection flags live in `~/.toby/config.json`. You can override the directory with the `TOBY_DIR` environment variable.

## 2. Connect

```bash
toby connect gmail
toby connect todoist
toby connect jira
```

List all integrations and whether they are connected:

```bash
toby connect
```

OAuth integrations (Gmail, Slack, Azure AD) open a browser or local callback during `connect`. Gmail, Todoist, Jira, and Azure AD are installable plugins bundled in release archives (installed to `~/.toby/plugins/`). API-key integrations validate credentials and mark the integration connected; Brave Search remains a built-in integration.

## 3. Check status

```bash
toby status
toby status integration -i gmail
```

Status shows connection health and, for some integrations, per-tool checks.

## Disconnect

```bash
toby disconnect gmail
```

This clears Toby’s connection flag. It does not delete your mail, tasks, or calendar data at the provider.

## Integration guides

| Integration | Guide |
| ----------- | ----- |
| Gmail | [Gmail](../integrations/gmail) |
| Todoist | [Todoist](../integrations/todoist) |
| Slack | [Slack](../integrations/slack) |
| Azure AD | [Azure AD](../integrations/azuread) |
| Apple Mail (macOS) | [Apple Mail](../integrations/apple-mail) |
| Apple Calendar (macOS) | [Apple Calendar](../integrations/apple-calendar) |
| macOS system controls | [macOS](../integrations/macos) |
| Brave Search | [Brave Search](../integrations/brave-search) |
| Jira | [Jira](../integrations/jira) |

## Next steps

- [Your first chat](./first-chat)
- [Integrations overview](../integrations/overview)
