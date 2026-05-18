---
sidebar_position: 4
title: Slack
---

# Slack

Connect Toby to Slack to search channels, read history, and post messages from chat.

**CLI name:** `slack`

## Prerequisites

- A Slack workspace where you can create or install an app
- Either a [Slack API app](#slack-app-setup-oauth-recommended) with OAuth credentials **or** a [bot token](#bot-token-alternative) (`xoxb-...`)

## Slack app setup (OAuth, recommended)

Toby’s OAuth flow uses **PKCE** on **`http://localhost:9878/callback`** (unless you override the redirect URI in configure). Slack treats localhost as a desktop redirect, so Toby requests **user token scopes only**—not bot scopes. Messages sent via chat post as **your Slack user**, not a bot.

### 1. Create a Slack app

1. Open [Slack API: Your Apps](https://api.slack.com/apps).
2. Click **Create New App → From scratch**.
3. Name the app and pick the **workspace** where you will install it.

### 2. Enable PKCE and set the redirect URI

1. In the app, open **OAuth & Permissions**.
2. Under **Redirect URLs**, add:

   ```text
   http://localhost:9878/callback
   ```

3. Enable **PKCE** (required for Toby’s localhost flow). Slack documents this under [Using PKCE](https://docs.slack.dev/authentication/using-pkce).

If you use a custom redirect URI in `toby config`, register that exact URL instead (must be `http://localhost` or `http://127.0.0.1` with a port and path).

### 3. Add user token scopes

Still on **OAuth & Permissions**, under **Scopes → User Token Scopes**, add:

| Scope | Purpose |
| ----- | ------- |
| `channels:read` | List public channels |
| `channels:history` | Read public channel history |
| `groups:read` | List private channels |
| `groups:history` | Read private channel history |
| `im:read` | List DMs |
| `im:history` | Read DM history |
| `mpim:read` | List group DMs |
| `mpim:history` | Read group DM history |
| `users:read` | Look up users |
| `users:read.email` | Resolve user emails |
| `chat:write` | Post messages |
| `search:read` | Search messages |

Do **not** rely on **Bot Token Scopes** for the OAuth path—localhost + PKCE cannot use bot scopes.

### 4. Copy Client ID and Client Secret

1. Open **Basic Information**.
2. Under **App Credentials**, copy **Client ID** and **Client Secret**.

Use these in the [Configure](#configure) section. Do not commit them to git; Toby stores them in `~/.toby/credentials.json`.

### 5. Connect from Toby

After saving credentials in `toby config`, run `toby connect slack`. Approve the app in the browser when prompted.

## Bot token (alternative)

Use this if you prefer a fixed **bot token** instead of OAuth. The bot posts as the app, not as you.

### 1. Create or open a Slack app

Same as [step 1](#1-create-a-slack-app) above at [api.slack.com/apps](https://api.slack.com/apps).

### 2. Add bot token scopes

On **OAuth & Permissions**, under **Scopes → Bot Token Scopes**, add the same capabilities as the [user scope table](#3-add-user-token-scopes) (for example `channels:read`, `channels:history`, `chat:write`, `search:read`, and the other scopes listed there).

### 3. Install the app to your workspace

1. On **OAuth & Permissions**, click **Install to Workspace** (or **Reinstall to Workspace**).
2. Approve the requested permissions.

### 4. Copy the Bot User OAuth Token

1. After install, copy **Bot User OAuth Token** (`xoxb-...`) from **OAuth & Permissions**.
2. In `toby config`, choose **Manual bot token** and paste it into **Bot Token**.

Run `toby connect slack` to validate the token.

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
| OAuth Redirect URI (optional) | Defaults to `http://localhost:9878/callback` if omitted |

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
