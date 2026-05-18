---
sidebar_position: 4
title: Slack
---

# Slack

Connect Toby to Slack to search channels, read history, and post messages from chat.

**CLI name:** `slack`

## Prerequisites

- A Slack workspace where you can install or authorize an app
- Either OAuth app credentials **or** a bot token (`xoxb-...`)

## Configure

```bash
toby config
```

Go to **Integrations → Slack** and choose an **Auth Method**:

### OAuth (recommended)

Create a Slack app with OAuth redirect support. In configure, enter:

| Field | Description |
| ----- | ----------- |
| OAuth Client ID | From your Slack app |
| OAuth Client Secret | From your Slack app |
| OAuth Redirect URI (optional) | Defaults to a localhost callback if omitted |

### Manual bot token

Choose **Manual bot token** and paste your **Bot Token** (`xoxb-...`).

Save the configuration.

## Connect

```bash
toby connect slack
```

- **OAuth:** Toby runs a PKCE flow on localhost; approve in the browser.
- **Bot token:** Connect validates the token and marks Slack connected.

## Verify

```bash
toby status integration -i slack
```

## Disconnect

```bash
toby disconnect slack
```

## Example chat prompts

- “Search #engineering for messages about the outage in the last 48 hours.”
- “Post a short standup summary to #team-updates.”

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
