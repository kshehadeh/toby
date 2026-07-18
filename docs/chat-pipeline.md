# Chat pipeline (and prompt caching)

This document describes how Toby prepares chat messages, runs a model turn, and (optionally) takes advantage of provider prompt caching to reduce repeated prompt tokens.

**Named non-chat workflows** (for example home dashboard AI blurbs) use a
separate runtime documented in [`agents.md`](agents.md). Do not confuse that
agent node graph with the chat turn stages below.

The pipeline implementation lives in **`@toby/core`** ([`packages/core/src/chat-pipeline/`](../packages/core/src/chat-pipeline/)). Native and web clients consume turns through the daemon HTTP API (`POST /api/sessions/:id/turn`, SSE `ChatEvent` stream). The turn runtime in [`turn-runtime.ts`](../packages/core/src/chat-pipeline/turn-runtime.ts) wraps `runChatTurnPipeline` for API consumers. See [`daemon.md`](daemon.md#unified-chat-api).

## Unified chat API (daemon)

| Layer | Path | Role |
| ----- | ---- | ---- |
| Contract types | [`packages/core/src/api/chat-api.ts`](../packages/core/src/api/chat-api.ts) | Request/response shapes shared by all surfaces |
| Turn runtime | [`packages/core/src/chat-pipeline/turn-runtime.ts`](../packages/core/src/chat-pipeline/turn-runtime.ts) | In-flight turns, ask-user, cancellation, persistence |
| Transcript reducer | [`packages/core/src/chat-pipeline/transcript-reducer.ts`](../packages/core/src/chat-pipeline/transcript-reducer.ts) | `ChatEvent` → `TranscriptEntry` (stream + reload parity) |
| HTTP client | [`packages/core/src/web/client.ts`](../packages/core/src/web/client.ts) | TypeScript SSE/REST client |

## Node pipeline architecture

Both the daemon API and the headless inbound path run the same **node pipeline** via `runChatTurnPipeline` in [`packages/core/src/chat-pipeline/pipeline.ts`](../packages/core/src/chat-pipeline/pipeline.ts). Each node is a discrete unit with typed inputs and outputs; nodes emit existing `ChatEvent` milestones for observability. Rendering (transcript rows, streaming assistant text) is **not** part of the pipeline — clients subscribe to the event stream.

```mermaid
flowchart LR
  init[TurnInitNode] --> expand[ExpandPromptNode]
  expand --> assemble[AssembleMessagesNode]
  assemble --> compact[CompactMessagesNode]
  compact --> run[RunModelTurnNode]
  run --> persist[PersistTurnNode]
```

| Node | Responsibility | Key implementation |
| ---- | -------------- | ------------------ |
| **TurnInitNode** | Load skills catalog, build tool catalog, decide `shouldPretreat` | [`nodes/turn-init.ts`](../packages/core/src/chat-pipeline/nodes/turn-init.ts) |
| **ExpandPromptNode** | Optional pretreatment; emits `prep_start` / `prep_end` | [`nodes/expand-prompt.ts`](../packages/core/src/chat-pipeline/nodes/expand-prompt.ts), [`pretreatment.ts`](../packages/core/src/ai/pretreatment.ts) |
| **AssembleMessagesNode** | Build/append `CoreMessage[]`, inject skill bodies; emits merge `lifecycle_*` on follow-up turns | [`nodes/assemble-messages.ts`](../packages/core/src/chat-pipeline/nodes/assemble-messages.ts), [`prepare-messages.ts`](../packages/core/src/prepare-messages.ts) |
| **CompactMessagesNode** | When estimated prompt tokens exceed a budget, clamp oversized parts and clear old tool results (persists rewrite) | [`nodes/compact-messages.ts`](../packages/core/src/chat-pipeline/nodes/compact-messages.ts), [`compaction/`](../packages/core/src/chat-pipeline/compaction/) |
| **RunModelTurnNode** | Single fused model+tool turn (AI SDK agentic loop) | [`nodes/run-model-turn.ts`](../packages/core/src/chat-pipeline/nodes/run-model-turn.ts), [`run-turn.ts`](../packages/core/src/chat-pipeline/run-turn.ts), [`chat.ts`](../packages/core/src/ai/chat.ts) |
| **PersistTurnNode** | Append messages to SQLite or emit save `lifecycle_*` | [`nodes/persist-turn.ts`](../packages/core/src/chat-pipeline/nodes/persist-turn.ts) |

**Query Model** and **Execute Tool** are intentionally **not** separate nodes. They alternate inside a single AI SDK `streamText` / `generateText` call (up to 12 steps) wrapped by `RunModelTurnNode`.

### Core types

Each node implements `PipelineNode<In, Out>`:

```ts
interface PipelineNode<In, Out> {
  readonly name: string;
  run(input: In, ctx: TurnContext): Promise<Out>;
}
```

Payloads chain across stages:

```
TurnRequest → InitedTurn → ExpandedTurn → AssembledTurn → RanTurn → CommittedTurn
```

| Payload | Carries |
| ------- | ------- |
| `TurnRequest` | `rawUserText`, `priorMessages`, `isFirstTurn` |
| `InitedTurn` | Skills catalog, tool catalog, `willPretreat`, integration label |
| `ExpandedTurn` | Effective prompt text, pretreatment `spec`, `prepId` |
| `AssembledTurn` | Full `CoreMessage[]` ready for the model |
| `RanTurn` | Model text, tool calls, `responseMessages`, usage |
| `CommittedTurn` | `messagesAfterTurn` (history + response) |

`TurnContext` holds per-turn services shared by all nodes (persona, modules, dry-run flag, abort signal, `askUser` handler, event sink, optional persistence config). Headless turns use a daemon-log event adapter; API turns use the daemon turn runtime.

### Driver and entry points

`runChatTurnPipeline(request, ctx, options?)` chains nodes in order. Options:

- **`stopAfter`** — run only through a given stage.
- **`assembled`** — skip prep stages and run `RunModelTurnNode` + `PersistTurnNode` from an existing `AssembledTurn`.

| Entry point | Pipeline usage |
| ----------- | -------------- |
| [`headless-session.ts`](../packages/core/src/chat-pipeline/headless-session.ts) | Full pipeline (`init` → `persist`); SQLite batch via `ctx.persist` |
| [`turn-runtime.ts`](../packages/core/src/chat-pipeline/turn-runtime.ts) | API/runtime wrapper for native and web clients |

### Observability (`ChatEvent`)

Nodes emit the existing event vocabulary — no new event types. The core transcript reducer maps events to transcript entries, and the daemon logs events at debug level.

| Event family | Emitted by |
| ------------ | ---------- |
| `prep_start` / `prep_end` | ExpandPromptNode |
| `lifecycle_*` | AssembleMessagesNode (merge), RunModelTurnNode (model request), PersistTurnNode (save) |
| `assistant_segment_*` / `assistant_text_delta` | RunModelTurnNode (via `chatWithTools`) |
| `tool_call_start` / `tool_call_complete` | RunModelTurnNode (via tool lifecycle hooks) |

### RunModelTurnNode internals

Inside `RunModelTurnNode`, the model/tool loop is unchanged:

```mermaid
flowchart LR
runTurn[runIntegrationChatTurn] --> chatWithTools[chatWithTools]
chatWithTools --> modelCall[streamText_or_generateText]
modelCall --> responseMsgs[response.messages]
```



Key files:

- `packages/core/src/chat-pipeline/pipeline.ts`: node types, `runChatTurnPipeline` driver, and stage chaining.
- `packages/core/src/chat-pipeline/nodes/`: discrete turn nodes (`turn-init`, `expand-prompt`, `assemble-messages`, `run-model-turn`, `persist-turn`).
- `packages/core/src/chat-pipeline/headless-session.ts`: daemon/inbound turn entry; builds `TurnContext` and runs the full pipeline.
- `packages/core/src/chat-pipeline/chat-events.ts`: shared UI-agnostic chat pipeline event types.
- `packages/core/src/ai/pretreatment.ts`: optional fast pretreatment (`generateText` + structured output) before the main turn; see **Pretreatment** below.
- `packages/core/src/skills/index.ts`: loads optional local skills from `~/.toby/skills/<name>/SKILL.md` (frontmatter `name` + `description`) for pretreatment selection and injection; see **Local skills** below.
- `packages/core/src/prepare-messages.ts`: initial message construction for a session.
- `packages/core/src/chat-pipeline/run-turn.ts`: shared integration turn runner (`runIntegrationChatTurn`, `runSharedChatTurn`).
- `packages/core/src/ai/chat.ts`: shared wrapper around AI SDK `streamText` / `generateText`, tool cache injection, lifecycle hooks, and abort signal propagation.

## Message construction (stable prefix vs dynamic content)

The chat pipeline intentionally keeps the **system message** as stable as possible, and pushes per-session/per-turn content into **user messages**.

Why:

- Providers that support prompt caching cache a **prefix** of the prompt. The more stable the prefix is across calls, the higher your cache hit rate.
- Any user/session-specific text inside the system prompt tends to break prefix similarity across sessions.

Where this is implemented:

- Email system prompt is static policy + tool strategy in `apps/plugin-email/src/prompts.ts` (`EMAIL_SINGLE_SESSION_RULES`; adapter wraps persona and global tools).
- Todoist system prompt is static policy + tool rules in `apps/plugin-todoist/src/prompts.ts` (returned from plugin `status.chatModelPrep`).
- Multi-integration system prompt is assembled in `packages/core/src/prepare-messages.ts` and does **not** embed the user request.
- The actual user request (and dynamic context like task snapshots) is always provided via `role: "user"` messages.

## Pretreatment and semantic routing (optional)

Before the main model turn, **ExpandPromptNode** runs **prompt preparation** that narrows **relevant local skills** and **relevant tools**, then **prepends** a compact intent block to the `role: "user"` content sent to the main model. Clients can still display the verbatim user line.

### Default: static semantic routing

By default, Toby uses **embedding-based routing** ([`packages/core/src/routing/`](../packages/core/src/routing/)) instead of an auxiliary LLM on the hot path:

1. **Turn-init** builds the tool catalog and **warms** a static index: tool/skill descriptions are embedded once per catalog signature and stored in SQLite (`routing_embeddings` in [`session-store.ts`](../packages/core/src/session-store.ts)).
2. **Expand-prompt** embeds the user message, runs cosine search, and selects up to **`TOBY_ROUTING_TOP_K`** integration-specific tools (default **8**) plus up to **2** skills above **`TOBY_ROUTING_MIN_SCORE`** (default **0.2** for tools; **`TOBY_ROUTING_SKILL_MIN_SCORE`** default **0.35** for skills — skills require a stronger match to avoid false-positive activation).
3. **Finalize** still applies the token-overlap skill heuristic and unions tools declared in selected skill frontmatter.

**Always-included tools** (base set in `ALWAYS_INCLUDED_TOOLS` in
[`run-turn.ts`](../packages/core/src/chat-pipeline/run-turn.ts): `askUser`,
`getCurrentDateTime`, `loadLocalSkillInstructions`, `writeTextFile`,
`tobyListIntegrations`, `tobyListTools`, `tobyListSkills`, `delegateToSubAgent`,
and core memory tools) are **not** part of the top-K count. Conditional globals
such as `webSearch` (when enabled) are also protected from relevance filtering
when present. So “top 8” means eight *additional* integration tools, not eight
tools total.

| Variable | Purpose |
| -------- | ------- |
| `TOBY_DISABLE_PRETREATMENT=1` | Skip preparation entirely; all tools are exposed to the main model. |
| `TOBY_SEMANTIC_ROUTING=0` | Opt into **legacy LLM pretreatment** (see below). |
| `TOBY_ROUTING_TOP_K` | Max integration-specific tools from semantic search (default `8`). |
| `TOBY_ROUTING_MIN_SCORE` | Minimum cosine similarity for tools (default `0.2`). |
| `TOBY_ROUTING_SKILL_MIN_SCORE` | Minimum cosine similarity for skills (default `0.35` — higher than tools to avoid false-positive skill activation). |
| `TOBY_ROUTING_EMBED_MODEL` | Embedding model (`text-embedding-3-small` or gateway `openai/text-embedding-3-small`). |

Embedding calls use the active persona’s AI provider (OpenAI or Vercel AI Gateway), same credentials as chat.

### Legacy LLM pretreatment (`TOBY_SEMANTIC_ROUTING=0`)

When semantic routing is disabled, **ExpandPromptNode** uses a **small structured LLM** (`gpt-4.1-nano` by default) to extract a full `UserIntentSpec` (goal, must/must-not, assumptions, open questions, integrations, skills, tools). Override with `TOBY_PRETREAT_MODEL`. **Delta** pretreatment (`TOBY_PRETREAT_DELTA=0` to disable) can reuse prior skill/tool scope on follow-ups.

### Shared behavior

- **When**: on **every** non-empty prompt unless `TOBY_DISABLE_PRETREATMENT=1`. [`shouldPretreat`](../packages/core/src/ai/pretreatment.ts) gates this.
- **Follow-up optimization**: trivial messages (`ok`, `yes`, `continue`, …) reuse the prior spec without re-embedding. Non-trivial follow-ups re-run semantic routing (legacy mode may use delta LLM instead).
- **Debug**: `TOBY_DEBUG_PREP=1` adjusts the **prompt preparation** transcript box detail when a spec was attached.
- **Caching**: SQLite **pretreatment cache** (`chat_pretreatment_cache`) stores successful routing results keyed by normalized user text, integration labels, catalog digests, routing mode, and embed/routing parameters — so identical prompts skip re-embedding.
- **Tool filtering**: Selected tools narrow the main turn via [`filterToolsByRelevance`](../packages/core/src/chat-pipeline/run-turn.ts).
- **Session naming**: First-turn session titles use a short heuristic from the user message (semantic mode) or LLM output (legacy mode).

## Local skills (optional)

Markdown skills in `~/.toby/skills/<skill-folder>/SKILL.md` use YAML frontmatter with at least `name` and `description`. Optional frontmatter fields:

- `tools` — explicit tool names the skill needs (comma-separated or YAML-ish `- item` bullets).
- `integrations` — integration display labels (e.g. `Gmail`, `Todoist`); every tool belonging to a listed integration is included.

When pretreatment selects a skill, the tools declared by `tools` and `integrations` are **unioned into the turn's `relevantTools`** (see `collectToolsForSelectedSkills` in [`skills/index.ts`](../packages/core/src/skills/index.ts) and `applySkillDeclaredTools` in [`pretreatment.ts`](../packages/core/src/ai/pretreatment.ts)). This makes tool scope deterministic for skill-driven flows instead of relying on the auxiliary model to independently list every needed tool. Declared tool names are validated against the active tool catalog; unknown names are dropped.

There are now two ways skills get into model context:

1. **On-demand tool loading (default path)**:
   - The global prompt includes a compact local skills catalog (`name: description`).
   - The model can call global tool `loadLocalSkillInstructions` with exact names to fetch full `SKILL.md` bodies mid-turn without user intervention.
2. **Pretreatment-selected skills (optional preflight path)**:
   - When pretreatment runs, it may set `relevantSkills` from that catalog.

For each turn:

- The **user** message includes a short “Selected skills” summary (names + descriptions) only when pretreatment selected them.
- The **system** message gains an appendix with the full markdown body of each selected skill (replacing any prior appendix from an earlier turn) only when pretreatment selected them.

If pretreatment is skipped (`shouldPretreat` false) or disabled (`TOBY_DISABLE_PRETREATMENT=1`), skill routing can still happen via `loadLocalSkillInstructions`.

To author a new skill from chat, ask explicitly (for example “create a skill for …”). The global tool **`createLocalSkill`** (see [`packages/core/src/ai/global-chat-tools.ts`](../packages/core/src/ai/global-chat-tools.ts)) is **not** in the always-included tool set: pretreatment must select it, matching Cursor’s `disable-model-invocation` pattern for skills that should not auto-apply.

## Toby self-reflection tools

Global reflection tools let the assistant answer questions about Toby itself without guessing from stale prompt text. The always-included subset includes:

- `tobyListIntegrations` — list available integrations, connection state, categories, capabilities, and resources.
- `tobyListTools` — list tools available in the current chat scope.
- `tobyListSkills` — list installed local skills.

Additional reflect helpers (when exposed by the global tool set) may cover setup
details and default providers; prefer the tools actually present in
`tobyListTools` output over assuming a fixed catalog.

These tools support prompts such as “Which integrations are connected?”, “What
tools can you use right now?”, and “What skills are installed?”

### Web content tools

Two global tools extend Toby's ability to access the web:

- **`fetchWebContent`** — Fetches a URL and extracts its main readable content using `@mozilla/readability`. Strips ads, navigation, footers, and other boilerplate. Returns article title, text content, excerpt, and metadata. No credentials needed. Implemented in [`packages/core/src/ai/web-fetch-tool.ts`](../packages/core/src/ai/web-fetch-tool.ts).
- **`webSearch`** — Searches the web via Perplexity through the Vercel AI Gateway. A client-side function tool whose `execute` makes a separate `generateText` call to the gateway with `openai/gpt-4.1-mini` + `gateway.tools.perplexitySearch()`. Returns titles, URLs, snippets, and optional dates. Available as a **conditional global tool** when web search is enabled in Settings and a Vercel AI Gateway API key is present (works with any persona AI provider). When available, it is protected from pretreatment filtering. See [`web-search.md`](web-search.md) and [`packages/core/src/ai/web-search-global-tools.ts`](../packages/core/src/ai/web-search-global-tools.ts).
- **`getWeather`** — Structured weather forecast for a place name or lat/lon and optional date via Open-Meteo (place names geocoded with Nominatim). Available as a **conditional global tool** when weather is enabled in Settings. No API key required for free tier. See [`weather.md`](weather.md) and [`packages/core/src/ai/weather/weather-global-tools.ts`](../packages/core/src/ai/weather/weather-global-tools.ts).
- **`getMyLocation`** — Current user location from macOS Location Services via Toby.app (lat/lon + optional reverse-geocoded place). Always registered; prompts for Location permission when needed. See [`location.md`](location.md) and [`packages/core/src/ai/location-global-tools.ts`](../packages/core/src/ai/location-global-tools.ts).

The combined system prompt includes routing rules: use `webSearch` when the user asks about current events or research, use `fetchWebContent` when the user shares a URL or asks to read a specific page, use `getWeather` (when enabled) for weather/forecast questions instead of web search, and use `getMyLocation` for “where am I” / “near me” geographic context.

## Turn execution (tools + streaming)

For each user submission:

1. `runChatTurnPipeline` runs **TurnInit → ExpandPrompt → AssembleMessages**.
2. **CompactMessagesNode** estimates prompt tokens; if over budget, applies zero-LLM compaction (see [Context compaction](#context-compaction)) and may rewrite stored model history.
3. **RunModelTurnNode** calls `runIntegrationChatTurn(...)` with the (possibly compacted) `messages` array (wiring an `AbortSignal` so the user can cancel with Escape).
4. `runIntegrationChatTurn` resolves integration modules by name, then delegates to `runSharedChatTurn` which merges their tools, adds global tools, applies prompt caching, and calls `chatWithTools(...)`.
5. `chatWithTools` applies `injectToolCache` (read-only tool result cache) then `injectToolLifecycleHooks` (events, callbacks, abort checks), and uses:
  - `streamText(...)` when clients want incremental tokens, or
  - `generateText(...)` in non-streaming contexts.
6. Tool lifecycle hooks (`onToolCallStart` / `onToolCallComplete`) and abort-signal checks are implemented by wrapping each tool’s `execute` in [`packages/core/src/ai/chat.ts`](../packages/core/src/ai/chat.ts). The `abortSignal` on `ChatWithToolsOptions` is propagated to `streamText`/`generateText` and checked before each tool execution. Optional `**onChatEvent**` emits UI-agnostic [`ChatEvent`](../packages/core/src/chat-pipeline/chat-events.ts) values (assistant segments at tool boundaries, tool start/complete, `prep_*`, `lifecycle_*` milestones, etc.).
7. **PersistTurnNode** appends `response.messages` to session history.

### Context compaction

Long sessions accumulate tool outputs and can exceed the model context window. **CompactMessagesNode** runs after message assembly and before the model turn:

1. **Budget** — target prompt tokens ≈ 75% of the known context window (Vercel catalog when available; otherwise a 128k default). Override ratio with `TOBY_COMPACTION_TARGET_RATIO`. Disable entirely with `TOBY_DISABLE_COMPACTION=1`.
2. **Tiered reclaim (zero-LLM)** — if over budget:
   - **Clamp** oversized assistant text / tool-call args (head + tail with a `[clamped: …]` marker).
   - **Dedupe superseded reads** — when the same resource is re-fetched (e.g. same `fetchWebContent` URL, email UID, Jira issue), blank older results and keep the newest. Keyed via [`result-keys.ts`](../packages/core/src/chat-pipeline/compaction/result-keys.ts); unknown tools are left alone.
   - **Clear old tool results** — blank oldest tool result payloads, keep the most recent pairs (default 6). Never clears `askUser` or core memory write tools. Skips clears that reclaim fewer than ~3k tokens (prompt-cache tradeoff).
3. **Persistence** — compacted model history is written via `replaceSessionMessages` so the next load does not rehydrate full bloat. The UI transcript is left unchanged. Persist append index is updated so only new response messages are appended.
4. **Observability** — `lifecycle_*` events and an optional `transcript_notice`; session log category `compaction`.

Implementation: [`packages/core/src/chat-pipeline/compaction/`](../packages/core/src/chat-pipeline/compaction/). Future tiers (LLM summarize, limit warner) are planned but not yet enabled.

### Tool result cache (read-only tools)

Chat turns also use a short-lived in-memory cache for select read-only chat tools:

- **TTL**: 5 minutes
- **Key**: `toolName + stable serialized args`
- **Scope**: SQLite-backed (`chat.sqlite`) so cache survives process restarts until TTL expiry
- **Eligibility**: read-only tool allowlist only (mutating tools and `askUser` are excluded)

Implementation paths:

- Cache implementation: `packages/core/src/chat-pipeline/tool-result-cache.ts`
- Cache lookup/store hook: `packages/core/src/ai/chat.ts` (`injectToolCache` wraps read-only tools; `injectToolLifecycleHooks` emits cache-hit events)
- UI marker: client transcript rows can append `[cache]` when a cached result is used.

### Abort signal

`ChatWithToolsOptions` accepts an optional `abortSignal` (standard `AbortSignal`). When provided:

- The signal is forwarded to `streamText` / `generateText`, so the provider request can be cancelled mid-flight.
- Before each tool execution, the signal is checked; if already aborted the tool throws instead of running.
- Runtime clients wire an `AbortController` per turn when cancellation is supported.

## Session recording & playback

The AI replay layer can record model responses to a JSON file and replay them later **without consuming AI tokens**. This is useful for pipeline debugging and repeatable demos.

### Flags

| Flag | Purpose |
| ---- | ------- |
| `--record <file>` | Record every model call (pretreatment + main turns) to `<file>`. Bare filenames are stored under `~/.toby/recordings/`. |
| `--replay <file>` | Replay recorded model responses from `<file>`. No API key is required. |

The flags are mutually exclusive.

Examples:

```bash
# Record via a headless/debug entrypoint
toby <headless entrypoint> --record inbox-triage.json

# Replay it (tools still run live against real integrations)
toby <headless entrypoint> --replay inbox-triage.json
```

### What is recorded

Recording intercepts model creation in [`createModelForPersona`](../packages/core/src/ai/model-factory.ts) via AI SDK middleware ([`packages/core/src/ai/replay/`](../packages/core/src/ai/replay/)). Each entry captures either:

- a **`generate`** result (`content`, `finishReason`, `usage`, …), or
- a **`stream`** sequence (ordered stream chunks including text deltas and tool calls).

The file format is versioned JSON (`version: 1`) with metadata (`createdAt`, persona provider/model) and an ordered `entries` array.

Call matching during replay uses a stable digest of normalized request params (prompt messages, tools, settings). Volatile bits are stripped before digesting — for example the injected current-datetime system appendix and cache-only `providerOptions` keys.

### Scope and caveats

- **Model-only**: replay substitutes model responses only. Integration tools (Gmail, Todoist, web fetch, etc.) still execute live during replay.
- **Pretreatment**: pretreatment has its own local SQLite cache that can change how many model calls occur between record and replay. Digest matching plus cursor fallback tolerates minor differences; for fully deterministic replays, use the same pretreatment cache state on both runs or set `TOBY_DISABLE_PRETREATMENT=1`.
- **Tool alignment**: because tool *calls* come from the recording but tool *results* are live, replay works best when external state has not changed materially since the recording.

Implementation paths:

- [`packages/core/src/ai/replay/session.ts`](../packages/core/src/ai/replay/session.ts) — process-global record/replay session state and file I/O
- [`packages/core/src/ai/replay/record-middleware.ts`](../packages/core/src/ai/replay/record-middleware.ts) — capture middleware
- [`packages/core/src/ai/replay/replay-model.ts`](../packages/core/src/ai/replay/replay-model.ts) — synthetic replay model

## AI prompt caching

Provider-specific prompt caching (OpenAI direct, Vercel AI Gateway, stable cache keys, status-line `cache=` / `cacheW=` telemetry, and adding new adapters) is documented in **[ai-caching.md](ai-caching.md)**.

Wiring in this pipeline:

- `packages/core/src/chat-pipeline/run-turn.ts` → `applyChatPromptCaching(...)` from `packages/core/src/ai/caching`
- `packages/core/src/ai/chat.ts` → forwards merged `providerOptions` to `streamText` / `generateText`
