# Daemon

## Overview

The **daemon** is a single long-running Toby process that runs work in the background for Toby.app, schedules, inbound chat, and local HTTP APIs. Only one instance may run at a time; it records lock metadata in **`~/.toby/daemon.lock`** (PID and poll interval) so `toby daemon start` can detect duplicates and `toby daemon stop` knows which process to signal.

Today the daemon has three responsibilities that run **in parallel** inside that process:

1. **Schedules** — cron-based prompts (summaries, inbox triage, etc.).
2. **Chat inbound** — listen on an external chat provider (Slack via Socket Mode today) and run chat turns when users @mention the bot.
3. **HTTP API server** — localhost API for the native macOS app and CLI.

Start it with `toby daemon start` (detached background) or `toby daemon run` (foreground, useful for debugging). Structured activity is appended to the **unified log** at `~/.toby/logs/toby.log` (JSON lines, `source: "daemon"`, shared buffering and rotation across all subsystems).

## Process model

```mermaid
flowchart TB
  subgraph proc [toby daemon process]
    lock[daemon.lock PID file]
    sched[Scheduler loop]
    inbound[Chat inbound listener]
    sched --> schedPoll[Poll due schedules every N seconds]
    inbound --> provider[Active chatInbound provider]
    provider --> router[Inbound router]
    router --> headless[Headless chat turn]
    headless --> sqlite[(chat.sqlite)]
  end
  slack[Slack Socket Mode] <-->|WebSocket| provider
```

| File | Role |
| ---- | ---- |
| `~/.toby/daemon.lock` | Holds daemon lock metadata (PID + interval); prevents duplicate instances |
| `~/.toby/logs/toby.log` | Unified structured log; daemon entries use `source: "daemon"` |
| `~/.toby/chat.sqlite` | Schedules, schedule runs, chat sessions, external session mapping |

Implementation entrypoints:

- CLI: [`apps/cli/src/commands/daemon.ts`](../apps/cli/src/commands/daemon.ts)
- Scheduler: [`apps/cli/src/schedules/scheduler.ts`](../apps/cli/src/schedules/scheduler.ts)
- Inbound: [`packages/core/src/chat-inbound/`](../packages/core/src/chat-inbound/)
- Log: [`packages/core/src/logging/daemon-log.ts`](../packages/core/src/logging/daemon-log.ts) (delegates to [`logger.ts`](../packages/core/src/logging/logger.ts))

## Commands

| Command | Description |
| ------- | ----------- |
| `toby daemon start` | Spawn a detached background daemon (default schedule poll: 60s) |
| `toby daemon run` | Foreground daemon (used internally by `start`) |
| `toby daemon stop` | Stop the process recorded in `daemon.lock` |
| `toby daemon restart` | Stop the daemon if running, then start it again (preserves poll interval unless `-i` is set) |
| `toby daemon status` | Show PID, inbound connection state, log path |

Toby.app can also restart the server from its native controls.

### App handshake (dev vs production)

Toby.app and the daemon share one localhost port and lock file. On launch (and on **Restart server**), the app:

1. Probes `GET /api/health` for daemon **identity** (version, executable path, `execKind`, `tobyDir`).
2. Compares that to the app’s preferred server (bundled `Contents/Resources/toby` for production builds; monorepo bun/source CLI for dev builds without a bundled binary).
3. If the running daemon mismatches (common after switching between **Toby (Dev)** and production), stops it — including force-killing a leftover PID from `daemon.lock` when HTTP stop is not enough — then starts the preferred binary.
4. Verifies identity after start; retries once if `daemon start` no-op’d on a still-living process.

Manual **Restart server** always uses the same preferred binary as launch (production no longer prefers the monorepo source CLI).

`start` accepts `-i, --interval <seconds>` to change the schedule poll interval. `restart` accepts the same option; when omitted, it reuses the interval from the running daemon's lock file, or 60s if the daemon was not running.

## Schedules

Schedules are stored in `chat.sqlite` and managed via `toby schedules` or **`/schedules`** in chat. Each schedule has a name, prompt, persona, cron expression, and enabled flag.

When the daemon is running, every poll interval it:

1. Loads schedules that may be due.
2. Evaluates cron against `lastRunAt`.
3. Runs matching schedules through the same tool-calling pipeline as headless chat (non-interactive; no `askUser`).

Schedule execution is logged under category `scheduler` in the unified log (`source: "daemon"`, `schedule_run_start`, `schedule_run_complete`, `schedules_fired`, etc.).

User-facing setup: [help-site schedules doc](../apps/help-site/docs/schedules.md).

## Chat inbound

Chat inbound lets Toby **listen** on a connected chat integration and respond in-thread through the same shared chat pipeline used by Toby.app.

### How it fits in the daemon

On startup the daemon calls `startChatInboundListeners()` alongside the scheduler loop. If inbound is not configured, the listener exits immediately and only schedules run.

When enabled, the daemon:

1. Reads `config.chatInbound` (integration name, persona, enabled flag).
2. Checks `integrations.<name>.inboundEnabled` and that the integration is connected.
3. Starts that module’s `chatInbound` provider (long-lived connection).
4. Routes normalized events through the shared inbound router.

Only **one** inbound integration is active at a time (e.g. `slack` today; Discord later via the same contract).

### End-to-end flow (@mention in Slack)

```mermaid
sequenceDiagram
  participant User
  participant Slack
  participant Listener as plugin-slack inbound run
  participant Router as chat-inbound/router
  participant Runner as headless-session
  participant DB as chat.sqlite

  User->>Slack: @toby summarize this thread
  Slack->>Listener: app_mention event
  Listener->>Router: InboundChatEvent
  Router->>DB: getOrCreateExternalSession
  Router->>Slack: status message post/update (progress)
  Router->>Runner: runHeadlessChatTurn
  Runner->>Runner: runChatTurnPipeline (init through persist)
  Runner->>DB: PersistTurnNode append messages
  Runner->>Router: assistant text / tool actions
  Router->>Slack: delete status message
  Router->>Slack: deliverReply if needed
  Slack->>User: reply in thread
```

**Triggers (Slack):**

- **`app_mention`** — starts a new turn; bot mention is stripped from the prompt text.
- **Direct message (`message.im`)** — any message in a 1:1 DM with the Toby app starts or continues a session (no `@` required).
- **Thread message** (channels only) — after an @mention started a Toby session for that thread, further replies in the thread are handled without another @mention.

Top-level channel messages without an @mention are still ignored.

### Session model

Each **external conversation** (Slack: workspace + channel + thread root) maps to one Toby chat session:

| Concept | Storage |
| ------- | ------- |
| External key | Provider-defined string, e.g. `slack:{teamId}:{channelId}:{threadRootTs}` |
| Toby session | `chat_sessions` row linked via `chat_external_sessions` |
| Message history | Same `chat_session_messages` table used by native/headless chat |
| Pending askUser | `awaiting_ask_user_json` on the external session row |

Follow-up @mentions in the **same thread** append to the same session and continue the `CoreMessage[]` history.

### Configuration

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
      "connectedAt": "2026-01-01T00:00:00.000Z",
      "inboundEnabled": true
    }
  }
}
```

Environment overrides:

| Variable | Purpose |
| -------- | ------- |
| `TOBY_CHAT_INBOUND_ENABLED` | `1` / `0` |
| `TOBY_CHAT_INBOUND_INTEGRATION` | e.g. `slack` |
| `TOBY_CHAT_INBOUND_PERSONA` | Persona name |

### Slack setup (reference provider)

Inbound uses **Socket Mode** with a **bot token** (`xoxb-...`) and **app token** (`xapp-...`). The user token from `toby connect slack` (OAuth) is for user-scoped Slack tools and does not power inbound.

1. Slack app: **Socket Mode** on; bot scopes including `app_mentions:read`, `chat:write`, and channel/history scopes; events `app_mention` + `message`.
2. `toby configure`: **Bot Token**, **App Token**, optional **Bot User ID** (visible when daemon inbound targets Slack, even if Auth Method is OAuth).
3. Enable `chatInbound` / `integrations.slack.inboundEnabled`, `toby connect slack` if using OAuth for chat, then `toby daemon start`.

**Which credential when:** see the tables in [help-site Slack integration](../apps/help-site/docs/integrations/slack.md#credentials-and-auth-reference) and [inbound section](../apps/help-site/docs/integrations/slack.md#inbound-mentions-daemon).

### askUser in inbound threads

When the model calls **askUser**, the daemon:

1. Posts the question and numbered options into the Slack thread.
2. Persists pending state on the external session.
3. Waits for the user’s next message in that thread.
4. Maps the reply (number, option label, or free text) and resumes the same tool-calling turn.

This mirrors interactive chat `askUser` behavior, but the “UI” is the chat thread.

### Provider contract (for new integrations)

Plugins with inbound capability implement `inbound run` (NDJSON); the harness
adapts that into `ChatInboundProvider` on the module. The daemon never imports
provider SDKs directly—transport lives in the plugin package (e.g.
[`apps/plugin-slack/`](../apps/plugin-slack/)).

Deep dive on types and extending: [chat-inbound.md](chat-inbound.md).

## Daemon log

All daemon subsystems log to the **unified log** at `~/.toby/logs/toby.log` with `source: "daemon"` via `daemonLog()` in [`packages/core/src/logging/daemon-log.ts`](../packages/core/src/logging/daemon-log.ts) (which delegates to the shared [`logger.ts`](../packages/core/src/logging/logger.ts)):

- Buffered append (flush every ~2s or 50 entries)
- JSON one object per line: `{ ts, source, level, category, type, data }`
- Rotation when file exceeds `TOBY_LOG_MAX_KB` (default 512), shared across all sources

**Categories:** `daemon`, `scheduler`, `inbound`, `turn`, `plugin`, `plugin-poller`, `general`.

### Tail the log

```bash
tail -f ~/.toby/logs/toby.log
```

**Useful events when debugging Slack:**

| type | Meaning |
| ---- | ------- |
| `daemon_started` | Daemon up; includes `logPath`, inbound config |
| `inbound_connecting` | Starting provider listener |
| `inbound_connected` | Provider accepted; for Slack, Socket Mode handshake done next |
| `slack_socket_starting` | Bolt app initializing |
| `slack_socket_connected` | WebSocket active; ready for `app_mention` |
| `slack_app_mention` | Mention received and routed |
| `turn_start` / `turn_complete` | Headless chat turn |
| `ask_user_posted` / `ask_user_resolved` | Interactive choice in thread |
| `inbound_stopped` | Daemon shutting down |

Compact one-line format (for scripts): `formatDaemonLogEntry()` in the daemon-log module, backed by the shared `formatUnifiedLogEntry()` in [`logger.ts`](../packages/core/src/logging/logger.ts).

## Troubleshooting

| Symptom | Things to check |
| ------- | ---------------- |
| Schedules never run | `toby daemon status`; log for `schedules_fired`; cron and `enabled` on schedule |
| No inbound activity | `chatInbound.enabled`, `integrations.slack.inboundEnabled`, Slack connected |
| Log shows `inbound_not_connected` | Run `toby connect slack` |
| No `slack_socket_connected` | Bot + app tokens in configure (not user OAuth alone); Socket Mode enabled; see [Slack credential reference](../apps/help-site/docs/integrations/slack.md#credentials-and-auth-reference) |
| Fatal: needs bot token (`xoxb`) | Paste **Bot Token** in configure; OAuth connect does not set it |
| Mentions ignored | Bot invited to channel; `app_mentions:read` scope; check `slack_app_mention` in log |
| Duplicate replies | Router dedupes by `messageId`; check log for `inbound_duplicate` |

## Unified chat API

The daemon exposes a **shared chat contract** for native and web clients. The full HTTP reference is [`server-api.md`](server-api.md). Types live in [`packages/core/src/api/chat-api.ts`](../packages/core/src/api/chat-api.ts); turn execution in [`packages/core/src/chat-pipeline/turn-runtime.ts`](../packages/core/src/chat-pipeline/turn-runtime.ts).

SSE streams emit `ChatEvent` JSON on default `data:` lines. Terminal events use named events: `done`, `error`, `ask_user_prompt`.

## Related docs

- [chat-inbound.md](chat-inbound.md) — provider contract, layers, Discord checklist
- [chat-pipeline.md](chat-pipeline.md) — node pipeline, pretreatment, tools, caching (shared with Toby.app and inbound)
- [integrations.md](integrations.md) — `chatInbound` on `IntegrationModule`
- [create-integration.md](create-integration.md#inbound-chat) — adding a new inbound provider
