---
sidebar_position: 1
title: Integrations overview
---

# Integrations overview

Integrations connect Toby to your email, tasks, chat, contacts, and calendar. Once connected, Toby can search, summarize, organize, and take action through **chat tools**—you describe what you want in natural language.

## The three-step pattern

Every integration uses the same workflow:

1. **Configure** — `toby config` → **Integrations** → enter credentials
2. **Connect** — `toby connect <name>` (OAuth where required)
3. **Status** — `toby status` or `toby status integration -i <name>`

See [Configure and connect](../getting-started/configure-and-status) for the full walkthrough.

## Available integrations

| Service | CLI name | Guide |
| ------- | -------- | ----- |
| Gmail | `gmail` | [Gmail](./gmail) |
| Todoist | `todoist` | [Todoist](./todoist) |
| Slack | `slack` | [Slack](./slack) |
| Azure AD | `azuread` | [Azure AD](./azuread) |
| Apple Mail | `applemail` | [Apple Mail](./apple-mail) |
| Apple Calendar | `applecalendar` | [Apple Calendar](./apple-calendar) |

## Using integrations in chat

**Default:** With multiple integrations connected, Toby merges their tools in one session.

**Scope to one integration** — Put the integration name first:

```text
gmail summarize unread messages from this week
```

**Pick explicitly** — `toby chat --integration gmail --integration todoist "..."` or **`/integration`** in the TUI.

## Other commands

Some integrations also support shared CLI commands:

```bash
toby summarize gmail
toby organize todoist --dry-run
```

## Next steps

Pick an integration from the table above and follow its setup guide.
