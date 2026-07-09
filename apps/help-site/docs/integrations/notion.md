---
sidebar_position: 10
title: Notion
---

# Notion

Connect Toby to Notion to search, read, create, and update durable document
content from chat.

**CLI name:** `notion`

Shipped as **`toby-plugin-notion`** (TypeScript bun-package). Release installs
place it in `~/.toby/plugins/`; from source run
`toby plugins install ./apps/plugin-notion`.

## Prerequisites

- A Notion account and workspace
- A Notion personal access token or internal connection token
- Pages/databases shared with the Notion connection you want Toby to access

## Get a Notion token

1. Open the [Notion developer portal](https://www.notion.so/profile/integrations).
2. Create a personal access token or internal connection for Toby.
3. Copy the token and keep it safe until you paste it into Toby.
4. In Notion, share the relevant pages or databases with the connection.

Do not commit the token to git. Toby stores it in `~/.toby/credentials.json` and
masks it in the configure UI.

## Configure

Open **Toby.app → Integrations → Notion** and enter:

| Field | Description |
| ----- | ----------- |
| Notion API Key | Personal access token or internal connection token |
| Default Parent Page ID | Optional parent page used when creating pages without an explicit `parentPageId` |

Save the configuration. You can also run `toby config` in the terminal.

## Connect

Click **Connect** in Toby.app, or run:

```bash
toby connect notion
```

Toby validates the token with the Notion API, then marks Notion as connected.

## Verify

```bash
toby status integration -i notion
```

## Chat capabilities

Notion belongs to the **Documents Provider** category. Toby can:

- Search accessible Notion pages and databases (`searchNotion`)
- Fetch page metadata (`getNotionPage`)
- List child blocks for a page or block (`listNotionBlockChildren`)
- Create a page from markdown (`createNotionPage`)
- Append markdown-derived content to an existing page (`appendNotionPageContent`)

Example prompts:

- “Search Notion for the launch plan.”
- “Create a Notion page with these meeting notes.”
- “Append this decision log to the project page.”
- “Find wiki pages about customer onboarding.”

You can scope chat to Notion in Toby.app by selecting Notion in the integration
picker, or by leading with the integration name:

```text
notion create a page for today's meeting notes
```

## Documents provider defaults

Open **Toby.app → Settings → Default Providers** and set **Documents Provider**
to Notion when you want document/wiki/notes prompts to prefer Notion. This is
especially useful for schedules that save recurring notes or search a knowledge
base.

## Disconnect

```bash
toby disconnect notion
```

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
