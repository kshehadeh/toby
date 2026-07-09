---
sidebar_position: 4
title: Slack
---

# Slack

Connect Toby to Slack to search channels, read history, and post messages from chat. Optionally enable [inbound @mentions](#inbound-mentions) so Toby can reply in threads while the app is running.

## What you need (by feature)

| Feature | Auth method in Toby | Tokens / fields |
| ------- | ------------------- | ---------------- |
| **Chat tools in Toby.app** | OAuth (recommended) **or** Manual bot token | OAuth: Client ID + Secret, then **Connect** (stores a **user** token). Bot token path: **Bot Token** only. |
| **@mentions (inbound)** | OAuth for chat is fine; inbound always needs extra tokens | **Bot Token** (`xoxb-...`) **and** **App Token** (`xapp-...`), plus inbound settings. User OAuth alone is not enough. |

OAuth and inbound are **not** the same credential: **Connect** with OAuth never stores a bot token, because Slack’s localhost PKCE flow only issues **user** scopes.

:::tip[Use the Setup Guide in Toby.app]
Open **Toby.app** → **Integrations → Slack** and click **Setup Guide**. The wizard shows the exact redirect URI and user scopes to paste into your Slack app, and helps you enter credentials and connect.
:::

## Credentials and auth reference

Everything below is set under **Toby.app → Integrations → Slack** (stored in `~/.toby/credentials.json`). Toby may mirror some fields under both `integrations.slack` and top-level `slack`; either location works.

| Configure field | Stored as | Prefix / form | When you need it | Why |
| --------------- | --------- | ------------- | ---------------- | --- |
| **Auth Method** | `authMethod` | `oauth` or `bot_token` | Always | Chooses how Slack chat tools authenticate. Inbound still needs a bot + app token regardless. |
| **OAuth Client ID** | `clientId` | Slack app ID | Auth Method = **OAuth** | Identifies your Slack app for the PKCE authorize URL. |
| **OAuth Client Secret** | `clientSecret` | Secret string | Auth Method = **OAuth** | Exchanged with Slack when you click **Connect**. |
| **OAuth Redirect URI** | `redirectUri` | URL (optional) | OAuth, only if not using default | Default `http://localhost:9878/callback`. Must match a redirect URL registered on the Slack app. |
| **Bot Token** | `botToken` | `xoxb-...` | **Manual bot token** auth, **or** inbound (any auth method) | Bot identity for Socket Mode and posting as the app. Not issued by Toby’s OAuth connect. |
| **App Token** | `appToken` | `xapp-...` | Inbound only | Socket Mode WebSocket (`connections:write`). Pair with bot token; not used for chat tools alone. |
| **Bot User ID** | `botUserId` | `U…` (optional) | Inbound (recommended) | Strips `<@U…>` from @mention text; can be filled automatically if omitted. |

**Set when you click Connect with OAuth (not typed in configure):**

| Stored field | Prefix | When | Why |
| ------------ | ------ | ---- | --- |
| `oauthUserToken` | `xoxp-…` / `xoxe-…` | After OAuth connect | API access for chat tools as **your** Slack user. |
| `oauthBotToken` | `xoxb-…` | Rarely (legacy bot OAuth) | Toby’s localhost OAuth does **not** populate this. Use **Bot Token** instead for inbound. |
| `teamId`, `teamName` | — | After connect | Workspace context for tools and inbound session keys. |

**Settings (not credentials)** — also under **Toby.app → Settings → Daemon / inbound chat** and related config in `~/.toby/config.json`:

| Setting | When | Why |
| ------- | ---- | --- |
| Inbound enabled + active integration **Slack** | Toby listens for @mentions | Master switch and which provider is used for inbound. |
| Per-integration inbound toggle for Slack | Same | Can sync when global inbound targets Slack. |
| Inbound persona | Optional | Persona for headless inbound turns. |

## Prerequisites

- A Slack workspace where you can create or install an app
- For chat: [OAuth app](#slack-app-setup-oauth-recommended) **or** a [bot token](#bot-token-alternative)
- For inbound: the same app (or another) with **Socket Mode**, a **bot token**, and an **app-level token** — see [Inbound @mentions](#inbound-mentions)

## Slack app setup (OAuth, recommended)

Toby’s OAuth flow uses **PKCE** on **`http://localhost:9878/callback`** (unless you override the redirect URI). Slack treats localhost as a desktop redirect, so Toby requests **user token scopes only**—not bot scopes. Messages sent via chat post as **your Slack user**, not a bot.

### Create from app manifest (recommended)

The fastest way to create a Slack app with the right PKCE redirect, OAuth scopes, Socket Mode, and inbound event subscriptions is to use Slack’s **app manifest**.

1. Open [Slack API: Your Apps](https://api.slack.com/apps).
2. Click **Create New App → From an app manifest**.
3. Select the **workspace** where you will install the app.
4. Paste the JSON below (or download [`slack-app-manifest.json`](/slack-app-manifest.json)).
5. Review the summary and click **Create**.

```json
{
  "display_information": {
    "name": "Toby"
  },
  "features": {
    "bot_user": {
      "display_name": "Toby",
      "always_online": true
    }
  },
  "oauth_config": {
    "redirect_urls": [
      "http://localhost:9878/callback"
    ],
    "scopes": {
      "user": [
        "im:read",
        "channels:read",
        "channels:write",
        "channels:history",
        "im:history",
        "im:write",
        "search:read"
      ],
      "bot": [
        "chat:write",
        "app_mentions:read",
        "groups:history",
        "im:history",
        "channels:history"
      ]
    },
    "pkce_enabled": true
  },
  "settings": {
    "event_subscriptions": {
      "bot_events": [
        "app_mention",
        "message.channels",
        "message.groups",
        "message.im"
      ]
    },
    "interactivity": {
      "is_enabled": true
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": true,
    "token_rotation_enabled": false,
    "is_mcp_enabled": false
  }
}
```

What this manifest configures:

| Area | Setting |
| ---- | ------- |
| **OAuth** | PKCE enabled; redirect `http://localhost:9878/callback` |
| **User scopes** | Channel/DM read, history, write, and search (for chat tools via OAuth) |
| **Bot scopes** | Post messages, read @mentions, and read channel/group/DM history (for inbound) |
| **Socket Mode** | Enabled (required for inbound without a public request URL) |
| **Event subscriptions** | `app_mention`, `message.channels`, `message.groups`, `message.im` |

After the app is created:

1. Copy **Client ID** and **Client Secret** from **Basic Information → App Credentials** → [Configure](#configure).
2. In Toby.app, save credentials and click **Connect** for OAuth chat.
3. For [inbound](#inbound-mentions): **Install to Workspace**, create an **App-Level Token** with `connections:write`, and paste **Bot Token** + **App Token** in Integrations → Slack.

If you use a custom redirect URI in Toby.app, edit **OAuth & Permissions → Redirect URLs** to match (must be `http://localhost` or `http://127.0.0.1` with a port and path).

### Configure manually

Use these steps if you prefer not to use a manifest, or need to adjust scopes after creation.

#### 1. Create a Slack app

1. Open [Slack API: Your Apps](https://api.slack.com/apps).
2. Click **Create New App → From scratch**.
3. Name the app and pick the **workspace** where you will install it.

#### 2. Enable PKCE and set the redirect URI

1. In the app, open **OAuth & Permissions**.
2. Under **Redirect URLs**, add:

   ```text
   http://localhost:9878/callback
   ```

3. Enable **PKCE** (required for Toby’s localhost flow). Slack documents this under [Using PKCE](https://docs.slack.dev/authentication/using-pkce).

If you use a custom redirect URI in Toby.app, register that exact URL instead (must be `http://localhost` or `http://127.0.0.1` with a port and path).

#### 3. Add user token scopes

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

#### 4. Copy Client ID and Client Secret

1. Open **Basic Information**.
2. Under **App Credentials**, copy **Client ID** and **Client Secret**.

Use these in the [Configure](#configure) section. Do not commit them to git; Toby stores them in `~/.toby/credentials.json`.

#### 5. Connect from Toby

After saving credentials in **Toby.app → Integrations → Slack**, click **Connect**. Approve the app in the browser when prompted. This stores a **user token** for chat—not a bot token. If you plan to use [inbound](#inbound-mentions), add **Bot Token** and **App Token** separately (steps in that section).

## Bot token (alternative)

Use this if you prefer a fixed **bot token** instead of OAuth. The bot posts as the app, not as you.

### 1. Create or open a Slack app

Same as [Create a Slack app](#1-create-a-slack-app) above at [api.slack.com/apps](https://api.slack.com/apps), or use the [app manifest](#create-from-app-manifest-recommended) instead.

### 2. Add bot token scopes

On **OAuth & Permissions**, under **Scopes → Bot Token Scopes**, add the same capabilities as the [user scope table](#3-add-user-token-scopes) (for example `channels:read`, `channels:history`, `chat:write`, `search:read`, and the other scopes listed there). The [app manifest](#create-from-app-manifest-recommended) includes the bot scopes needed for inbound.

### 3. Install the app to your workspace

1. On **OAuth & Permissions**, click **Install to Workspace** (or **Reinstall to Workspace**).
2. Approve the requested permissions.

### 4. Copy the Bot User OAuth Token

1. After install, copy **Bot User OAuth Token** (`xoxb-...`) from **OAuth & Permissions**.
2. In **Toby.app → Integrations → Slack**, choose **Manual bot token** and paste it into **Bot Token**.

Click **Connect** to validate the token.

## Configure

Open **Toby.app → Integrations → Slack**. Field visibility depends on **Auth Method** and whether **Daemon / inbound chat** targets Slack (see [credentials reference](#credentials-and-auth-reference)).

### OAuth (recommended for chat)

| Field | Required for | Notes |
| ----- | ------------ | ----- |
| OAuth Client ID | Connect (OAuth) | From **Basic Information → App Credentials**. |
| OAuth Client Secret | Connect (OAuth) | Same page; stored masked. |
| OAuth Redirect URI | Optional | Omit to use `http://localhost:9878/callback`. |

After save, click **Connect**. That stores the user token for chat tools.

If you use inbound, also set **Bot Token** and **App Token** (shown when inbound is enabled for Slack). OAuth does not replace those.

### Manual bot token (chat as the bot)

| Field | Required for | Notes |
| ----- | ------------ | ----- |
| Bot Token (`xoxb-...`) | Chat + inbound | From **OAuth & Permissions → Bot User OAuth Token** after install. |

Click **Connect** to validate. For inbound, add **App Token** as well.

### Inbound-only fields

| Field | Required for | Notes |
| ----- | ------------ | ----- |
| App Token (`xapp-...`) | Inbound Socket Mode | **Basic Information → App-Level Tokens** → create with scope `connections:write`. Enable **Socket Mode** on the app. |
| Bot Token (`xoxb-...`) | Inbound | Same bot token as manual auth; required even if chat uses OAuth. |
| Bot User ID | Optional | From the bot’s profile; helps strip @mentions. |

Save the configuration.

## Connect

On the Slack detail page, click **Connect**.

- **OAuth:** Toby runs a PKCE flow on localhost; approve in the browser.
- **Bot token:** Toby validates the token and marks Slack connected.

## Verify

Return to **Integrations** in the sidebar. Slack should show as connected and healthy.

## Disconnect

Open the Slack detail page and click **Disconnect**.

## Example chat prompts

- “Search #engineering for messages about the outage in the last 48 hours.”
- “Post a short standup summary to #team-updates.”

## Inbound @mentions

Toby can listen for **@mentions** while the app’s local service is running and reply in the same thread (optional **askUser** prompts in-thread).

### Why inbound needs different tokens than OAuth chat

| Token | Used for inbound? | Reason |
| ----- | ----------------- | ------ |
| User token from OAuth Connect (`xoxp-…`) | **No** | Socket Mode and @mention handling run as the **bot** app, not your user. |
| Bot token (`xoxb-…`) | **Yes** | Receive events, post replies, thread `askUser` prompts. |
| App token (`xapp-…`) | **Yes** | Opens the Socket Mode WebSocket to Slack (no public request URL). |

You can keep **Auth Method = OAuth** for chat tools and still paste **Bot Token** + **App Token** for inbound.

### Slack app setup for inbound

If you used the [app manifest](#create-from-app-manifest-recommended), Socket Mode, bot scopes, and event subscriptions are already configured. You still need to install the app, create an app-level token, and copy tokens into Toby.

1. **Socket Mode** — On in your Slack app settings (enabled by the manifest).
2. **Bot Token Scopes** — At minimum: `app_mentions:read`, `chat:write`, plus channel/history scopes you need for context (included in the manifest).
3. **Event Subscriptions** — Subscribe to bot events: `app_mention` (channels), `message.im` (DMs with the app), and `message.channels` / `message.groups` (thread follow-ups after an @mention in those places).
4. **Install app** to the workspace; copy **Bot User OAuth Token** → **Bot Token** in Toby.
5. **App-Level Token** — Create with `connections:write` → **App Token** in Toby.
6. Invite the bot to channels where you will @mention it.

### Enable inbound in Toby

1. Open **Toby.app → Settings → Daemon / inbound chat**: enable, set **Active integration** to Slack, pick a persona.
2. **Integrations → Slack**: set **Bot Token**, **App Token**, optional **Bot User ID** (fields appear when inbound is enabled, even under OAuth).
3. Click **Connect** if you use OAuth for chat (marks Slack connected).
4. Keep **Toby.app** running so the local service can maintain the Socket Mode connection.
5. @mention the bot in a channel thread.

Each workspace + channel + thread root is one persisted Toby chat session.

## Related

- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
