---
sidebar_position: 4
title: Configure and connect
---

# Configure and connect integrations

Every integration follows the same pattern: **configure credentials → connect → verify status**.

## 1. Open Integrations

Open **Toby.app** and click **Integrations** in the sidebar. The Integrations window shows all available integrations and their connection status.

![Toby.app Integrations window](/img/toby-app-integrations-overview.png)

Click any integration to view its detail page, where you can fill in credentials, run a setup guide, connect, and check status.

## 2. Configure credentials

Choose a service in the Integrations window and fill in the fields on its detail page (API keys, OAuth client IDs, and so on). Each integration detail has a **Setup Guide** button that walks you through provider steps, shows copyable values like redirect URIs and scopes, and lets you fill credentials and connect without leaving the app.

### Example: Email

![Toby.app Email integration detail](/img/toby-app-integrations-email.png)

Enter your IMAP and SMTP host, port, username, and password. Click **Setup Guide** for a step-by-step wizard.

### Example: Apple Calendar

![Toby.app Apple Calendar integration detail](/img/toby-app-integrations-calendar.png)

Apple Calendar needs no credentials — just click **Connect** and grant Calendar permission to Toby.app in System Settings when prompted.

Credentials live in `~/.toby/credentials.json`. Connection flags live in `~/.toby/config.json`.

## 3. Connect

Click **Connect** on the integration detail page. Toby validates credentials and marks the integration connected.

OAuth integrations (for example Slack) open a browser or local callback during connect. API-key integrations validate credentials and connect immediately.

## 4. Check status

Return to the Integrations window to see connection status at a glance. Each integration shows whether it is connected and healthy.

## Disconnect

Open the integration detail page and click **Disconnect**. This clears Toby's connection flag — it does not delete your mail, tasks, or calendar data at the provider.

## Integration guides

| Integration | Guide |
| ----------- | ----- |
| Email | [Email](../integrations/email) |
| Todoist | [Todoist](../integrations/todoist) |
| Slack | [Slack](../integrations/slack) |
| Apple Calendar (macOS) | [Apple Calendar](../integrations/apple-calendar) |
| macOS system controls | [macOS](../integrations/macos) |
| Web Search | [Web Search](../integrations/web-search) |
| Jira | [Jira](../integrations/jira) |
| Notion | [Notion](../integrations/notion) |

## Next steps

- [Your first chat](./first-chat)
- [Integrations overview](../integrations/overview)
