---
sidebar_position: 4
title: Slack
---

# <span class="docs-brand-title"><img class="docs-brand-icon" src="/img/integrations/slack.png" alt="" width="40" height="40" />Slack</span>

Connect Toby to Slack to search channels, read history, and post messages from chat. Optionally enable [inbound @mentions](#inbound-mentions) so Toby can reply in threads while the app is running.

## What you need (by feature)

| Feature | Auth method in Toby | Tokens / fields |
| ------- | ------------------- | ---------------- |
| **Chat tools in Toby.app** | OAuth (recommended) **or** Bot token | OAuth: Client ID, then authorize in the wizard (stores a **user** token). Bot token path: **Bot token** only. |
| **@mentions (inbound)** | OAuth for chat is fine; inbound always needs extra tokens | **Bot token** (`xoxb-...`) **and** **App token** (`xapp-...`) under **Mentions**. User OAuth alone is not enough. |

OAuth and inbound are **not** the same credential: **Connect** with OAuth never stores a bot token, because Slack’s localhost PKCE flow only issues **user** scopes.

## Guided setup (recommended)

Open **Toby.app → Settings → Integrations → Slack → Set up Slack**. The wizard
uses the same step-by-step layout as AI provider setup:

1. Choose **tools only** or **receive DMs and @mentions**. Select **Use an existing
   Slack app** if you already created one.
2. Click **Create Toby app in Slack**. Choose your workspace and review the
   prefilled permissions, events, Socket Mode, and DM settings. You can also copy
   the manifest and create an app from it manually.
3. Under **OAuth & Permissions**, install the app and copy the **Bot User OAuth
   Token** (`xoxb-…`) into the wizard.
4. For inbound, create an **App-Level Token** under **Basic Information** with
   `connections:write`, then paste the `xapp-…` token. Toby checks authentication,
   required bot scopes when Slack reports them, and Socket Mode access before saving.
5. Optionally authorize **message search** using the app's **Client ID**. PKCE
   does not require a client secret. You can skip this and use bot tools.
6. Choose an inbound persona and click **Enable inbound**. This replaces any
   other selected inbound integration. Send a DM or channel @mention yourself;
   the wizard confirms a received event and a delivered reply in the same conversation.

![Slack setup wizard with preconfigured app creation](/img/toby-app-slack-setup-app.png)

Each successfully checked credential stage is saved; failed checks leave your
previous credentials intact. Closing and returning preserves setup choices,
while token drafts are discarded. Saved tokens can be reused without copying
again. **Cancel setup** stops a pending check or browser authorization.

**Re-authorize** also opens this wizard and keeps your saved connection until
the replacement credentials pass their checks.

You may finish without the message test, but the completion screen marks inbound
verification as incomplete. A connected Socket Mode transport alone does not
prove that Slack sends the right events. The test waits for up to two minutes;
use **Check again** after sending a message if it pauses.

Toby does not create the app through an API after user OAuth. The prefilled link
still requires you to review creation, approve installation, and generate the
app-level token. Workspace administrators may need to approve installation.

## Credentials and auth reference

Everything below is set under **Toby.app → Settings → Integrations → Slack** (stored in `~/.toby/credentials.json`). Toby may mirror some fields under both `integrations.slack` and top-level `slack`; either location works.

| Configure field | Stored as | Prefix / form | When you need it | Why |
| --------------- | --------- | ------------- | ---------------- | --- |
| **Sign in › Method** | `authMethod` | `oauth` or `bot_token` | Always | Chooses how Slack chat tools authenticate. Inbound still needs a bot + app token regardless. |
| **Client ID** | `clientId` | Numeric client identifier | Auth Method = **OAuth** | Identifies your Slack app for the PKCE authorize URL. |
| **Client secret** | `clientSecret` | Legacy optional field | Not needed for PKCE | Retained for compatibility; Toby’s public-client PKCE exchange does not send it. |
| **Redirect URL** | `redirectUri` | URL (optional) | OAuth, only if not using default | Default `http://localhost:9878/callback`. Must match a redirect URL registered on the Slack app. |
| **Bot token** | `botToken` | `xoxb-...` | **Bot token** sign-in, **or** inbound (any auth method) | Bot identity for Socket Mode and posting as the app. Not issued by Toby’s OAuth connect. |
| **App token** | `appToken` | `xapp-...` | Inbound only | Socket Mode WebSocket (`connections:write`). Pair with bot token; not used for chat tools alone. |
| **Bot user ID** | `botUserId` | `U…` (optional) | Inbound (recommended) | Strips `<@U…>` from @mention text; can be filled automatically if omitted. |

**Set when you click Connect with OAuth (not typed in configure):**

| Stored field | Prefix | When | Why |
| ------------ | ------ | ---- | --- |
| `oauthUserToken` | `xoxp-…` / `xoxe-…` | After OAuth connect | API access for chat tools as **your** Slack user. |
| `oauthBotToken` | `xoxb-…` | Rarely (legacy bot OAuth) | Toby’s localhost OAuth does **not** populate this. Use **Bot token** instead for inbound. |
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
4. Download and paste [`slack-app-manifest.json`](/slack-app-manifest.json).
5. Review the summary and click **Create**.

The downloadable manifest is generated from the same source as the wizard’s
creation link, so both use the same permissions and settings.


What this manifest configures:

| Area | Setting |
| ---- | ------- |
| **OAuth** | PKCE enabled; redirect `http://localhost:9878/callback` |
| **User scopes** | Channel/DM read, history, write, and search (for chat tools via OAuth) |
| **Bot scopes** | Post messages, read @mentions, and read channel/group/DM history (for inbound) |
| **Socket Mode** | Enabled (required for inbound without a public request URL) |
| **Event subscriptions** | `app_mention`, `message.channels`, `message.groups`, `message.im`, `message.mpim` |

After the app is created:

1. Copy **Client ID** from **Basic Information → App Credentials** → [Configure](#configure).
2. In Toby.app, use **Set up Slack → Add message search** for OAuth chat.
3. For [inbound](#inbound-mentions): **Install to Workspace**, create an **App-Level Token** with `connections:write`, and paste **Bot token** + **App token** under **Mentions** in Integrations → Slack.

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

#### 4. Copy Client ID

1. Open **Basic Information**.
2. Under **App Credentials**, copy **Client ID**.

Use these in the [Configure](#configure) section. Do not commit them to git; Toby stores them in `~/.toby/credentials.json`.

#### 5. Connect from Toby

After saving credentials in **Toby.app → Settings → Integrations → Slack**, use **Set up Slack → Add message search**. Approve the app in the browser when prompted. This stores a **user token** for chat—not a bot token. If you plan to use [inbound](#inbound-mentions), add **Bot token** and **App token** under **Mentions** (steps in that section).

## Bot token (alternative)

Use this if you prefer a fixed **bot token** instead of OAuth. The bot posts as the app, not as you.

### 1. Create or open a Slack app

Same as [Create a Slack app](#1-create-a-slack-app) above at [api.slack.com/apps](https://api.slack.com/apps), or use the [app manifest](#create-from-app-manifest-recommended) instead.

### 2. Add bot token scopes

On **OAuth & Permissions**, under **Scopes → Bot Token Scopes**, use the bot scopes in the [downloadable manifest](/slack-app-manifest.json). Message search needs user OAuth; do not add user-only scopes to the bot. The [app manifest](#create-from-app-manifest-recommended) includes the bot scopes needed for inbound.

### 3. Install the app to your workspace

1. On **OAuth & Permissions**, click **Install to Workspace** (or **Reinstall to Workspace**).
2. Approve the requested permissions.

### 4. Copy the Bot User OAuth Token

1. After install, copy **Bot User OAuth Token** (`xoxb-...`) from **OAuth & Permissions**.
2. In **Toby.app → Settings → Integrations → Slack**, set **Sign in › Method** to **Bot token** and paste it into **Bot token**.

Click **Connect** to validate the token.

## Configure

Open **Toby.app → Settings → Integrations → Slack**. Field visibility depends on **Auth Method** and whether **Daemon / inbound chat** targets Slack (see [credentials reference](#credentials-and-auth-reference)).

### OAuth (recommended for chat)

| Field | Required for | Notes |
| ----- | ------------ | ----- |
| Client ID | Connect (OAuth) | From **Basic Information → App Credentials**. |
| Client secret | Legacy optional field | Not required for PKCE sign-in. |
| Redirect URL | Optional | Omit to use `http://localhost:9878/callback`. |

After save, click **Connect**. That stores the user token for chat tools.

If you use inbound, turn on **Reply when someone @mentions Toby** under **Mentions** and set **Bot token** and **App token** there. OAuth does not replace those.

### Bot token (chat as the bot)

| Field | Required for | Notes |
| ----- | ------------ | ----- |
| Bot token (`xoxb-...`) | Chat + inbound | From **OAuth & Permissions → Bot User OAuth Token** after install. |

Click **Connect** to validate. For inbound, add **App token** under **Mentions** as well.

### Inbound-only fields

| Field | Required for | Notes |
| ----- | ------------ | ----- |
| App token (`xapp-...`) | Inbound Socket Mode | **Basic Information → App-Level Tokens** → create with scope `connections:write`. Enable **Socket Mode** on the app. |
| Bot token (`xoxb-...`) | Inbound | Same bot token as bot-token sign-in; required even if chat uses OAuth. |
| Bot user ID | Optional | From the bot’s profile; helps strip @mentions. |

Save the configuration.

## Connect

On the Slack detail page, click **Connect**.

- **OAuth:** Toby runs a PKCE flow on localhost; approve in the browser.
- **Bot token:** Toby validates the token and marks Slack connected.

## Verify

Return to **Settings → Integrations**. Slack should show as connected and healthy.

## Disconnect

Select Slack in **Settings → Integrations** and click **Disconnect**.

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

You can keep **Sign in › Method** on **OAuth** for chat tools and still paste **Bot token** + **App token** under **Mentions** for inbound.

### Slack app setup for inbound

If you used the [app manifest](#create-from-app-manifest-recommended), Socket Mode, bot scopes, and event subscriptions are already configured. You still need to install the app, create an app-level token, and copy tokens into Toby.

1. **Socket Mode** — On in your Slack app settings (enabled by the manifest).
2. **Bot Token Scopes** — At minimum: `app_mentions:read`, `chat:write`, plus channel/history scopes you need for context (included in the manifest).
3. **Event Subscriptions** — Subscribe to bot events: `app_mention` (channels), `message.im` (DMs with the app), and `message.channels` / `message.groups` (thread follow-ups after an @mention in those places).
4. **Install app** to the workspace; copy **Bot User OAuth Token** → **Bot Token** in Toby.
5. **App-Level Token** — Create with `connections:write` → **App Token** in Toby.
6. Invite the bot to channels where you will @mention it.

### Enable inbound in Toby

1. Open **Toby.app → Settings → Chat** (inbound): enable, set **Active integration** to Slack, pick a persona. See [Inbound chat](../configuration/inbound-chat).
2. **Integrations → Slack → Mentions**: turn on **Reply when someone @mentions Toby**, then set **Bot token**, **App token** and optional **Bot user ID** (shown while mentions are on, even under OAuth).
3. Click **Connect** if you use OAuth for chat (marks Slack connected).
4. Keep **Toby.app** running so the local service can maintain the Socket Mode connection.
5. @mention the bot in a channel thread, or open a **DM** with the Toby app and message it directly.

### How Slack maps to Toby sessions

Toby keeps conversation history by linking each Slack place to one chat session:

| You talk in… | Toby treats as… | How to continue |
| ------------ | --------------- | --------------- |
| A **channel/group thread** (after you @mention the bot) | One session for that **thread** | Keep replying in the same thread (another @ is optional once the session exists) |
| A **new** top-level @mention in a channel | A **new** thread and a **new** session | Use that new thread for follow-ups |
| A **DM** with the Toby app | One session for the **whole DM** | Send another message in the same DM—no @ required |

Top-level messages in a channel **without** an @mention are ignored. Deleting the matching session in Toby.app clears history for that thread/DM; the next message starts a clean session in the same Slack place.

Product-level overview (all chat apps): [Chat surfaces → How conversations map to Toby sessions](../chat-surfaces/overview#how-conversations-map-to-toby-sessions). Settings: [Inbound chat](../configuration/inbound-chat).

## Related

- [Chat surfaces](../chat-surfaces/overview) — tools vs inbound overview, session mapping
- [Inbound chat](../configuration/inbound-chat) — Settings → Chat
- [Integrations overview](overview)
- [Configure and connect](../getting-started/configure-and-status)
