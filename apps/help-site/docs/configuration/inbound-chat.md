---
sidebar_position: 4
title: Inbound chat
---

# Inbound chat

**Inbound chat** lets an external integration (today primarily **Slack**) drive Toby turns without you typing in the Mac app—for example when someone @mentions the bot in a channel.

Settings live under **Toby.app → Settings → Chat** (inbound / daemon chat).

## Global settings

| Setting | Purpose |
| ------- | ------- |
| **Enable inbound chat** | Master switch. Off by default. |
| **Active integration** | Which connected integration owns inbound (for example Slack), or **None** |
| **Persona for inbound turns** | Persona used for headless turns, or **(default)** for your default persona |

These values are stored in `~/.toby/config.json` under `chatInbound.*`.

The background service must be running (Toby.app normally keeps it up). Inbound status also appears in daemon status (`/api/daemon/status` and the app’s server status UI).

## Per-integration requirements

Global enable is not enough. The active integration must:

1. Be **connected** under Integrations  
2. Support inbound (plugin capability, for example Slack’s `inbound run`)  
3. Have any **extra credentials** inbound needs (often different from chat OAuth)

### Slack example

Slack chat tools can use user OAuth, but **@mentions** need a **bot token** and **app-level token**, Socket Mode, and the right scopes. Full steps: [Slack → Inbound @mentions](../integrations/slack#inbound-mentions).

Typical flow:

1. **Settings → Chat** — enable inbound, set **Active integration** to Slack, pick a persona.
2. **Integrations → Slack** — set Bot Token, App Token (and related fields that appear when inbound targets Slack).
3. Ensure the Slack app has Socket Mode and event subscriptions as described in the Slack guide.

## Behavior notes

- Inbound turns use the same core chat pipeline as the Mac app (tools, memory, skills), under the chosen persona.
- Turning inbound **off** stops listening; it does not disconnect the integration or delete credentials.
- Only one **active** inbound integration is selected globally at a time.
- **Sessions:** external threads and DMs map to Toby chat sessions so follow-ups keep context. In Slack, that means **one session per channel thread**, and **one session per 1:1 DM** with the bot (not a new session on every message). See [Chat surfaces → How conversations map to Toby sessions](../chat-surfaces/overview#how-conversations-map-to-toby-sessions).

## Related

- [Chat surfaces](../chat-surfaces/overview) — tools vs inbound product overview
- [Configuration overview](./overview)
- [Slack](../integrations/slack) — OAuth vs inbound tokens
- [Local APIs](../api/overview) — daemon status fields for inbound
