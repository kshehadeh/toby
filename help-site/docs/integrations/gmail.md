---
sidebar_position: 2
title: Gmail
---

# Gmail

Connect Toby to your Gmail account to read, search, and organize email from chat.

**CLI name:** `gmail`

## Prerequisites

- A Google Cloud project with the Gmail API enabled
- OAuth 2.0 **Client ID** and **Client Secret** (Desktop or Web application type, depending on your OAuth setup)

## Configure

```bash
toby config
```

Go to **Integrations → Gmail** and enter:

| Field | Description |
| ----- | ----------- |
| Client ID | OAuth client ID from Google Cloud Console |
| Client Secret | OAuth client secret (stored masked) |

Save the configuration.

## Connect

```bash
toby connect gmail
```

Toby opens the Google OAuth flow. After you approve access, tokens are stored and Gmail is marked connected.

## Verify

```bash
toby status integration -i gmail
```

## Disconnect

```bash
toby disconnect gmail
```

## Example chat prompts

- “Summarize my unread email from today and list anything that needs a reply.”
- “Find threads about the Q2 launch and suggest labels or archive actions.”

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
