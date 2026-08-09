# Chat inbound (provider contract)

For daemon commands, configuration, logging, and Slack setup, see **[daemon.md](daemon.md)**.

This document describes the **provider-agnostic inbound architecture**: how external chat conversations map to Toby sessions and how to add a new integration.

## Architecture

| Layer | Location | Role |
| ----- | -------- | ---- |
| Core | `packages/core/src/chat-inbound/` | Router, askUser bridge, status, listener startup |
| Pipeline | `packages/core/src/chat-pipeline/headless-session.ts` | Calls `runChatTurnPipeline` (full node chain through persist); integration selection via [`resolve-chat-modules.ts`](../packages/core/src/chat-pipeline/resolve-chat-modules.ts) |
| Storage | `packages/core/src/session-store.ts` | `chat_external_sessions` maps external conversation → Toby session |
| Plugin adapter | `packages/core/src/integrations/plugins/inbound-adapter.ts` | Spawns plugin `inbound run` (NDJSON) and implements `ChatInboundProvider` |
| Provider transport | Plugin package (e.g. `apps/plugin-slack/`) | Socket Mode / platform SDK, event normalization, deliver reply/askUser |

## Session model

Inbound does **not** merge conversations by topic or time. It maps a stable **external conversation identity** to exactly one Toby `chat_sessions` row.

### Storage

| Concept | Storage |
| ------- | ------- |
| Primary key | `(integration, external_key)` on `chat_external_sessions` |
| Toby session | `session_id` → `chat_sessions` |
| Provider metadata | JSON blob (`channelId`, `threadRootTs`, …) |
| Message history | Same `chat_session_messages` table as native/headless chat |
| Pending `askUser` | `awaiting_ask_user_json` on the external session row |
| Dedup | `last_processed_message_id` (provider message id) |

Implementation: `getOrCreateExternalSession` / `loadExternalSession` in
[`session-store.ts`](../packages/core/src/session-store.ts). Router entry:
[`chat-inbound/router.ts`](../packages/core/src/chat-inbound/router.ts).

### Existing session vs new session

On each inbound event the router calls `getOrCreateExternalSession({ integration, externalKey, … })`:

1. **Lookup** `(integration, external_key)`.
2. **Hit + live `chat_sessions` row** → reuse that session id (continue history).
3. **Hit but chat session was deleted** (user removed it in Toby.app) → create a **new** empty `chat_sessions` row and **relink** the same external key (history for that mapping is gone).
4. **Miss** → create a new `chat_sessions` row and insert the external mapping.

There is **no** idle timeout or automatic “start fresh after N hours.” Continuity is entirely keyed by `external_key` until the mapping is deleted or relinked.

Also before a turn runs:

- Ignore messages authored by the bot itself.
- Ignore duplicates when `messageId` was already processed for that external key.
- If `awaiting_ask_user` is set and the event matches an answer, clear pending state and run a **continuation** turn on the **same** session (not a new key).
- Otherwise only events with `isNewConversationTurn: true` start a full turn (providers set this flag when classifying transport events).

Per-conversation mutex (`integration:externalKey`) serializes concurrent messages for the same external conversation.

### External key (provider-defined)

Providers own the string format. Contract: **stable for one logical conversation**, different when the platform conversation is different. Documented on the plugin as `inboundPrep.externalKeyFormat`.

Each turn also resolves **chat-capable integrations** from the user message (keyword + default-provider rules, same as scheduled runs) and always includes the inbound transport (e.g. Slack). A request like “check my unread emails” loads the email integration (or your default email provider), not Slack alone.

## Configuration

### Configure UI

In **Toby.app** settings (or `toby config`, which opens the app), open **Daemon /
inbound chat**:

- **Enable inbound chat** — master switch
- **Active integration** — which provider the daemon listens on (e.g. `slack`)
- **Persona for inbound turns** — persona used for headless replies

Under each inbound-capable integration (e.g. **Slack**), set **Daemon: listen for @mentions** to **On**. Both the global **Active integration** and that integration’s inbound toggle must be enabled.

Values persist through the configure API into `~/.toby/config.json`.

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

`oauthUserToken` from `toby connect slack` is only for user-scoped Slack tools. You can use OAuth for chat tools and still paste bot + app tokens for the daemon.

Also set `inboundEnabled` on the Slack integration (and global `chatInbound`). Full field-by-field reference: [help-site Slack credentials](../apps/help-site/docs/integrations/slack.md#credentials-and-auth-reference).

Setup checklist:

1. Slack app with **Socket Mode** enabled.
2. Bot scopes: `app_mentions:read`, `chat:write`, channel/history scopes (see help site).
3. Events: `app_mention`, `message`.
4. Toby.app settings (or configure API): **Bot Token**, **App Token**, optional **Bot User ID**.
5. `toby connect slack` (if using OAuth for chat), enable inbound in config, `toby daemon start`.

### Triggers and classification

Logic lives in [`apps/plugin-slack/src/inbound-logic.ts`](../apps/plugin-slack/src/inbound-logic.ts)
and Socket Mode handlers in [`inbound-run.ts`](../apps/plugin-slack/src/inbound-run.ts).

| Event / surface | When it is handled | Notes |
| --------------- | ------------------ | ----- |
| **`app_mention`** | Always (non-empty text after stripping `<@bot>`) | Starts or continues a turn; `isNewConversationTurn: true`. |
| **Channel / group `message` in a thread** | Only if Toby already has an external session for that thread **or** `askUser` is pending | No second `@mention` required for follow-ups in a known thread. Top-level channel messages **without** `thread_ts` are ignored. |
| **DM (`message.im`, channel id `D…`)** | Every non-empty user message | No `@mention` required. Classified as `new_turn`, or `ask_user_reply` when pending. |
| Bot’s own messages | Ignored | By author id / subtype filters. |

Channel classification (`classifySlackInboundMessage`): random replies in unknown threads are **ignored** so chatter in arbitrary threads does not open sessions. Only threads Toby already owns (typically after an `@mention`) continue.

### External key and thread root

Format:

```text
slack:{teamId}:{channelId}:{threadRootTs}
```

`threadRootTs` is resolved by `resolveSlackThreadRootTs`:

| Context | `threadRootTs` value | Effect on Toby session |
| ------- | -------------------- | ---------------------- |
| Channel `@mention` not yet in a thread | The mention message’s own `ts` | **New** key → new session; replies use this as thread root. |
| Channel message / mention already in a thread | Slack `thread_ts` | **Same** key as other messages in that thread → same session. |
| 1:1 DM, top-level messages | The **DM channel id** (`D…`), not each message `ts` | **One** session for the whole DM stream. |
| Nested thread **inside** a DM | Real Slack `thread_ts` | **Separate** session for that nested thread. |

Replies: when the DM root is the channel id, Toby posts **without** `thread_ts` (main DM stream). Channel/thread sessions reply **in** the Slack thread (`slackReplyThreadTs`).

Mental model:

```text
Slack identity (team + channel + thread root)
    → external_key = slack:team:channel:threadRoot
    → chat_external_sessions lookup
        → hit  → existing Toby session (full history)
        → miss → new Toby session
```

There is **no** semantic merge across different channel threads. A new top-level `@mention` in a channel always creates a new thread root and therefore a new Toby session.

### DMs with the Toby Slack app

A user chatting only with the bot (Apps → Toby / DM) is the common “always one thread” case:

1. DM channels are detected by id prefix `D`.
2. Without a nested Slack thread, `threadRootTs = channelId`.
3. Key is stable: `slack:{teamId}:{Dxxxx}:{Dxxxx}`.
4. Message 1 creates the mapping; messages 2…N append to the **same** Toby session indefinitely.
5. No idle-based rotation; deleting the session in Toby.app relinks a fresh empty session to the same DM key.

### askUser in Slack

While a turn waits on `askUser`:

1. Question + numbered options are posted into the conversation (thread or DM).
2. Pending state is stored on the external session (`awaiting_ask_user_json`).
3. The next matching user message in that same external conversation completes the choice (number, option text, or free text).
4. The router runs a continuation turn on the **same** session id.

Pending state is persisted in SQLite so a daemon restart can still resolve answers.

### Processing status (Slack)

While a turn runs, Slack inbound posts a **temporary status message** in the same thread (not ephemeral):

1. First progress line → `chat.postMessage` with a **context** Block Kit block (dimmed/smaller text), e.g. `⏳ _Preparing request…_` (emoji per action + italic mrkdwn).
2. Later lines → `chat.update` (throttled ~1s, same mapping as the CLI activity footer: prep/lifecycle events and tool calls).
3. When the turn finishes or errors → `chat.delete` on the status message, then the final reply (or error) is posted.

Emoji hints include ⏳ prep, 🤖 model, 📧 email tools, ✅ tasks, 🧠 thinking, ❓ askUser, 📋 plans. Providers implement `formatInboundStatusLine` for custom formatting.

The router wires `ChatEvent`s from `runHeadlessChatTurn` through an optional `InboundStatusReporter` (`createStatusReporter` on the provider). `dryRun` skips all status API calls.

## Adding a provider (e.g. Discord)

Ship a **plugin** with `"inbound"` capability and implement `inbound run`
(NDJSON) per [plugin-protocol.md](plugin-protocol.md#inbound-chat-daemon-transport).
The harness wraps that transport as `ChatInboundProvider` via
[`inbound-adapter.ts`](../packages/core/src/integrations/plugins/inbound-adapter.ts).
See [create-integration.md](create-integration.md#5-inbound-chat-optional).

Optional: status update / clear messages during a turn (Slack uses
post/update/delete; other platforms may use typing indicators or ephemeral
messages). The router already wires progress into `runHeadlessChatTurn` and
clears status before `deliverReply`.

## Related

- [daemon.md](daemon.md) — running the daemon, schedules + inbound, the unified log (`logs/toby.log`), troubleshooting
- [plugin-protocol.md](plugin-protocol.md) — `inbound run` NDJSON contract and `externalKeyFormat`
- Help site: [Chat surfaces](../apps/help-site/docs/chat-surfaces/overview.md) (user-facing session overview), [Slack inbound](../apps/help-site/docs/integrations/slack.md#inbound-mentions)
