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

Open **Integrations**, choose a service, and fill in the fields (API keys, OAuth client IDs, and so on). Save when done.

Credentials live in `~/.toby/credentials.json`. Connection flags live in `~/.toby/config.json`. You can override the directory with the `TOBY_DIR` environment variable.

## 2. Connect

```bash
toby connect gmail
toby connect todoist
```

List all integrations and whether they are connected:

```bash
toby connect
```

OAuth integrations (Gmail, Slack, Azure AD) open a browser or local callback during `connect`. API-key integrations (Todoist) validate the key and mark the integration connected.

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

## Next steps

- [Your first chat](./first-chat)
- [Integrations overview](../integrations/overview)
