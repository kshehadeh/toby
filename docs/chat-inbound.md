# Chat inbound (provider contract)

For daemon commands, configuration, logging, and Slack setup, see **[daemon.md](daemon.md)**.

This document describes the **provider-agnostic inbound architecture**: how external chat conversations map to Toby sessions and how to add a new integration.

## Architecture

| Layer | Location | Role |
| ----- | -------- | ---- |
| Core | `packages/core/src/chat-inbound/` | Router, askUser bridge, status, listener startup |
| Pipeline | `packages/core/src/chat-pipeline/headless-session.ts` | Calls `runChatTurnPipeline` (full node chain through persist); integration selection via [`resolve-chat-modules.ts`](../packages/core/src/chat-pipeline/resolve-chat-modules.ts) |
| Storage | `packages/core/src/session-store.ts` | `chat_external_sessions` maps external conversation → Toby session |
| Provider | `packages/core/src/integrations/<name>/inbound.ts` | Transport, event normalization, `deliverReply` / `deliverAskUser`, optional `createStatusReporter` |

## Session model

One **external conversation** (e.g. Slack channel + thread root) maps to one Toby `chat_sessions` row:

- Key: `(integration, external_key)` — provider defines `external_key` (e.g. `slack:{teamId}:{channelId}:{threadRootTs}`).
- Metadata: JSON blob per provider (`channelId`, `threadRootTs`, etc.).
- Message history: same `chat_session_messages` table as the Ink TUI.

Each turn resolves **chat-capable integrations** from the user message (keyword + default-provider rules, same as scheduled runs) and always includes the inbound transport (e.g. Slack). A request like “check my unread emails” loads Gmail (or your default email provider), not Slack alone.

## Configuration

### Configure UI

Run `toby configure` (or `toby config`) and open **Daemon / inbound chat**:

- **Enable inbound chat** — master switch
- **Active integration** — which provider the daemon listens on (e.g. `slack`)
- **Persona for inbound turns** — persona used for headless replies

Under each inbound-capable integration (e.g. **Slack**), set **Daemon: listen for @mentions** to **On**. Both the global **Active integration** and that integration’s inbound toggle must be enabled.

Save with **Ctrl+S** in the configure UI.

### config.json

In `~/.toby/config.json`:

```json
{
  "chatInbound": {
    "enabled": true,
    "integration": "slack",
    "persona": "Toby"
  },
  "integrations": {
    "slack": {
      "connectedAt": "...",
      "inboundEnabled": true
    }
  }
}
```

Environment overrides:

- `TOBY_CHAT_INBOUND_ENABLED` — `1` / `0`
- `TOBY_CHAT_INBOUND_INTEGRATION` — e.g. `slack`
- `TOBY_CHAT_INBOUND_PERSONA` — persona name

Only **one** inbound integration is active at a time.

## Slack (reference provider)

Inbound needs **two tokens** that OAuth connect does not provide:

| Token | Configure field | Why |
| ----- | --------------- | --- |
| `xoxb-...` | **Bot Token** | Bot API + posting as the app |
| `xapp-...` | **App Token** | Socket Mode WebSocket (`connections:write`) |

`oauthUserToken` from `toby connect slack` is only for **`toby chat`** (user-scoped tools). You can use OAuth for chat and still paste bot + app tokens for the daemon.

Also set `inboundEnabled` on the Slack integration (and global `chatInbound`). Full field-by-field reference: [help-site Slack credentials](../apps/help-site/docs/integrations/slack.md#credentials-and-auth-reference).

Setup checklist:

1. Slack app with **Socket Mode** enabled.
2. Bot scopes: `app_mentions:read`, `chat:write`, channel/history scopes (see help site).
3. Events: `app_mention`, `message`.
4. `toby configure`: **Bot Token**, **App Token**, optional **Bot User ID**.
5. `toby connect slack` (if using OAuth for chat), enable inbound in config, `toby daemon start`.

Triggers:

- **`app_mention`** — starts or continues a turn (mention stripped from prompt).
- **Thread reply** — while `askUser` is pending, the next user message in that thread completes the choice.

### Processing status (Slack)

While a turn runs, Slack inbound posts a **temporary status message** in the same thread (not ephemeral):

1. First progress line → `chat.postMessage` with a **context** Block Kit block (dimmed/smaller text), e.g. `⏳ _Preparing request…_` (emoji per action + italic mrkdwn).
2. Later lines → `chat.update` (throttled ~1s, same mapping as the CLI activity footer: prep/lifecycle events and tool calls).
3. When the turn finishes or errors → `chat.delete` on the status message, then the final reply (or error) is posted.

Emoji hints include ⏳ prep, 🤖 model, 📧 email tools, ✅ tasks, 🧠 thinking, ❓ askUser, 📋 plans. Providers implement `formatInboundStatusLine` for custom formatting.

The router wires `ChatEvent`s from `runHeadlessChatTurn` through an optional `InboundStatusReporter` (`createStatusReporter` on the provider). `dryRun` skips all status API calls.

## Adding a provider (e.g. Discord)

Implement `ChatInboundProvider` on your `IntegrationModule` (`chatInbound` field). See [create-integration.md](create-integration.md#inbound-chat).

Optional: implement `createStatusReporter` to show transient progress during a turn (Slack uses post/update/delete; other platforms may use typing indicators or ephemeral messages).

The router already calls `createStatusReporter`, passes `onProgress` into `runHeadlessChatTurn`, and `clear()`s the reporter before `deliverReply`.

## Related

- [daemon.md](daemon.md) — running the daemon, schedules + inbound, `daemon.log`, troubleshooting
