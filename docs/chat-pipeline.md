# Chat pipeline (and prompt caching)

This document describes how `toby chat` prepares messages, runs a model turn, and (optionally) takes advantage of provider prompt caching to reduce repeated prompt tokens.

## Node pipeline architecture

Both the Ink TUI (`toby chat`) and the headless daemon/inbound path run the same **node pipeline** via `runChatTurnPipeline` in [`src/chat-pipeline/pipeline.ts`](../src/chat-pipeline/pipeline.ts). Each node is a discrete unit with typed inputs and outputs; nodes emit existing `ChatEvent` milestones for observability. Rendering (transcript rows, streaming assistant text) is **not** part of the pipeline — consumers subscribe to the event stream.

```mermaid
flowchart LR
  init[TurnInitNode] --> expand[ExpandPromptNode]
  expand --> assemble[AssembleMessagesNode]
  assemble --> run[RunModelTurnNode]
  run --> persist[PersistTurnNode]
```

| Node | Responsibility | Key implementation |
| ---- | -------------- | ------------------ |
| **TurnInitNode** | Load skills catalog, build tool catalog, decide `shouldPretreat` | [`nodes/turn-init.ts`](../src/chat-pipeline/nodes/turn-init.ts) |
| **ExpandPromptNode** | Optional pretreatment; emits `prep_start` / `prep_end` | [`nodes/expand-prompt.ts`](../src/chat-pipeline/nodes/expand-prompt.ts), [`pretreatment.ts`](../src/ai/pretreatment.ts) |
| **AssembleMessagesNode** | Build/append `CoreMessage[]`, inject skill bodies; emits merge `lifecycle_*` on follow-up turns | [`nodes/assemble-messages.ts`](../src/chat-pipeline/nodes/assemble-messages.ts), [`prepare-messages.ts`](../src/ui/chat/prepare-messages.ts) |
| **RunModelTurnNode** | Single fused model+tool turn (AI SDK agentic loop) | [`nodes/run-model-turn.ts`](../src/chat-pipeline/nodes/run-model-turn.ts), [`run-turn.ts`](../src/chat-pipeline/run-turn.ts), [`chat.ts`](../src/ai/chat.ts) |
| **PersistTurnNode** | Append messages to SQLite (headless) or emit save `lifecycle_*` (Ink UI) | [`nodes/persist-turn.ts`](../src/chat-pipeline/nodes/persist-turn.ts) |

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

`TurnContext` holds per-turn services shared by all nodes (persona, modules, dry-run flag, abort signal, `askUser` handler, event sink, optional persistence config). Ink builds context via [`pipeline-turn-context.ts`](../src/ui/chat/pipeline-turn-context.ts); headless uses a daemon-log event adapter.

### Driver and entry points

`runChatTurnPipeline(request, ctx, options?)` chains nodes in order. Options:

- **`stopAfter`** — run only through a given stage (e.g. Ink boot/submit stop at `"assemble"` before updating React state).
- **`assembled`** — skip prep stages and run `RunModelTurnNode` + `PersistTurnNode` from an existing `AssembledTurn` (Ink execution after submit).

| Entry point | Pipeline usage |
| ----------- | -------------- |
| [`headless-session.ts`](../src/chat-pipeline/headless-session.ts) | Full pipeline (`init` → `persist`); SQLite batch via `ctx.persist` |
| [`chat-session-app.tsx`](../src/ui/chat/chat-session-app.tsx) boot/submit | `stopAfter: "assemble"`, then `{ assembled }` for model turn |
| [`chat-session-app.tsx`](../src/ui/chat/chat-session-app.tsx) `runModelTurn` | `{ assembled }` only; `emitPersistLifecycle: true`, React effects handle SQLite |

### Observability (`ChatEvent`)

Nodes emit the existing event vocabulary — no new event types. Ink maps events to transcript rows via [`chat-event-reducer.ts`](../src/ui/chat/chat-event-reducer.ts); the daemon logs events at debug level.

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

- `src/chat-pipeline/pipeline.ts`: node types, `runChatTurnPipeline` driver, and stage chaining.
- `src/chat-pipeline/nodes/`: discrete turn nodes (`turn-init`, `expand-prompt`, `assemble-messages`, `run-model-turn`, `persist-turn`).
- `src/chat-pipeline/headless-session.ts`: daemon/inbound turn entry; builds `TurnContext` and runs the full pipeline.
- `src/ui/chat/chat-session-app.tsx`: Ink TUI; runs prep stages (`stopAfter: "assemble"`) then execution via `{ assembled }`.
- `src/ui/chat/pipeline-turn-context.ts`: helper to build `TurnContext` for the Ink session.
- `src/chat-pipeline/chat-events.ts`: shared UI-agnostic chat pipeline event types.
- `src/ai/pretreatment.ts`: optional fast pretreatment (`generateText` + structured output) before the main turn; see **Pretreatment** below.
- `src/skills/index.ts`: loads optional local skills from `~/.toby/skills/<name>/SKILL.md` (frontmatter `name` + `description`) for pretreatment selection and injection; see **Local skills** below.
- `src/ui/chat/prepare-messages.ts`: initial message construction for a session.
- `src/chat-pipeline/run-turn.ts`: shared integration turn runner (`runIntegrationChatTurn`, `runSharedChatTurn`). `src/ui/chat/run-turn.ts` re-exports from this module.
- `src/ai/chat.ts`: shared wrapper around AI SDK `streamText` / `generateText`, tool cache injection, lifecycle hooks, and abort signal propagation.

## Message construction (stable prefix vs dynamic content)

The chat pipeline intentionally keeps the **system message** as stable as possible, and pushes per-session/per-turn content into **user messages**.

Why:

- Providers that support prompt caching cache a **prefix** of the prompt. The more stable the prefix is across calls, the higher your cache hit rate.
- Any user/session-specific text inside the system prompt tends to break prefix similarity across sessions.

Where this is implemented:

- Gmail system prompt is static policy + tool strategy in `src/integrations/gmail/prompts/chat.ts` (`buildGmailChatSystemMessage`).
- Todoist system prompt is static policy + tool rules in `src/integrations/todoist/prompts/chat.ts` (`buildTodoistChatSystemMessage`).
- Multi-integration system prompt is assembled in `src/ui/chat/prepare-messages.ts` and does **not** embed the user request.
- The actual user request (and dynamic context like task snapshots) is always provided via `role: "user"` messages.

## Pretreatment (optional)

Before the main model turn, **ExpandPromptNode** may run a **small, fast** LLM call that extracts a structured intent spec (goal, must/must-not, assumptions, open questions, likely integrations, **relevant local skills**, and relevant tools) and **prepends** it to the `role: "user"` content sent to the main model. The Ink transcript still shows the **verbatim** user line.

- **When**: on **every** non-empty prompt. `[shouldPretreat](../src/ai/pretreatment.ts)` now returns `true` for any non-blank user text so each turn validates intent and narrows the tool/skill set. Disable entirely with `TOBY_DISABLE_PRETREATMENT=1`. (The legacy `TOBY_PRETREAT_FIRST_TURN` flag is deprecated and no longer gates first-turn behavior. Repeated cost is mitigated by the local pretreatment cache; per-turn selectivity is a future optimization.)
- **Provider**: uses the active persona’s AI provider (OpenAI direct or Vercel AI Gateway via [`model-factory.ts`](../src/ai/model-factory.ts)).
- **Model**: defaults to `gpt-4.1-mini` for OpenAI, or `openai/gpt-4.1-mini` for Vercel gateway. Override with `TOBY_PRETREAT_MODEL` (bare id for OpenAI, or a full `provider/model` slug for gateway). Disable entirely with `TOBY_DISABLE_PRETREATMENT=1`.
- **Debug**: `TOBY_DEBUG_PREP=1` adjusts the **prompt preparation** transcript box detail when a spec was attached (no separate `meta` line).
- **Caching**:
  - Pretreatment uses its own short system prompt and is **not** included in the main `promptCacheKey` merge. The wrapped user text remains dynamic user-role content, so the stable-prefix caching strategy for the main turn is unchanged.
  - Toby also keeps a small **local SQLite cache** of successful pretreatment results (global across sessions) so repeated prompts can **skip the pretreatment model call** entirely.
    - **Keying**: derived from normalized user text + normalized integration labels + pretreat model id + a digest of the available skill catalog + a pretreat cache schema version.
    - **Storage**: stored in `chat.sqlite` (see `src/ui/chat/session-store.ts`).
    - **Invalidation**: bumping the pretreat cache schema version (or changing model id / prompt construction inputs / local skill catalog) naturally produces new keys.
  - **Policy**: success-only (failed/timeout pretreatments are not cached).
- **Tool filtering**: When pretreatment identifies relevant tools, Toby can narrow the active tool set for the main turn while preserving always-included global tools.
- **Session naming**: Pretreatment may suggest a short descriptive session name for newly started chats.

## Local skills (optional)

Markdown skills in `~/.toby/skills/<skill-folder>/SKILL.md` use YAML frontmatter with at least `name` and `description`.

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

To author a new skill from chat, the global tool **`createLocalSkill`** (see [`src/ai/global-chat-tools.ts`](../src/ai/global-chat-tools.ts)) drafts a full `SKILL.md` with the persona model and saves it under `~/.toby/skills/`.

## Toby self-reflection tools

Global reflection tools let the assistant answer questions about Toby itself without guessing from stale prompt text:

- `tobyListIntegrations` — list available integrations, connection state, categories, capabilities, and resources.
- `tobyGetIntegrationSetup` — explain setup requirements for a specific integration.
- `tobyListDefaults` — show configured default providers by category.
- `tobyListTools` — list tools available in the current chat scope.
- `tobyListSkills` — list installed local skills.

These tools support prompts such as “Which integrations are connected?”, “How do I set up Jira?”, “What tools can you use right now?”, and “What skills are installed?”

### Web content tools (always-included)

Two global tools extend Toby's ability to access the web:

- **`fetchWebContent`** — Fetches a URL and extracts its main readable content using `@mozilla/readability`. Strips ads, navigation, footers, and other boilerplate. Returns article title, text content, excerpt, and metadata. Always available (no credentials needed). Implemented in [`src/ai/web-fetch-tool.ts`](../src/ai/web-fetch-tool.ts).
- **`webSearch`** — Searches the web using the Brave Search API. Returns titles, URLs, descriptions, and optional page age. Available as a **conditional global tool** when a Brave Search API key is configured in credentials. When available, it is always included in the tool set (protected from pretreatment filtering via `ALWAYS_INCLUDED_TOOLS`). Implemented in [`src/integrations/bravesearch/tools.ts`](../src/integrations/bravesearch/tools.ts).

Both tools are in the `ALWAYS_INCLUDED_TOOLS` set, so pretreatment's relevance filtering never removes them. The combined system prompt includes routing rules: use `webSearch` when the user asks about current events or research, use `fetchWebContent` when the user shares a URL or asks to read a specific page.

## Turn execution (tools + streaming)

For each user submission:

1. `runChatTurnPipeline` runs **TurnInit → ExpandPrompt → AssembleMessages** (Ink boot/submit stop here; headless continues).
2. **RunModelTurnNode** calls `runIntegrationChatTurn(...)` with the full `messages` array (wiring an `AbortSignal` so the user can cancel with Escape).
3. `runIntegrationChatTurn` resolves integration modules by name, then delegates to `runSharedChatTurn` which merges their tools, adds global tools, applies prompt caching, and calls `chatWithTools(...)`.
4. `chatWithTools` applies `injectToolCache` (read-only tool result cache) then `injectToolLifecycleHooks` (events, callbacks, abort checks), and uses:
  - `streamText(...)` when the Ink UI wants incremental tokens, or
  - `generateText(...)` in non-streaming contexts.
5. Tool lifecycle hooks (`onToolCallStart` / `onToolCallComplete`) and abort-signal checks are implemented by wrapping each tool’s `execute` in `[src/ai/chat.ts](../src/ai/chat.ts)`. The `abortSignal` on `ChatWithToolsOptions` is propagated to `streamText`/`generateText` and checked before each tool execution. Optional `**onChatEvent**` emits UI-agnostic `[ChatEvent](../src/chat-pipeline/chat-events.ts)` values (assistant segments at tool boundaries, tool start/complete, `prep_*`, `lifecycle_*` milestones, etc.). The Ink session maps those events to transcript rows via `[src/ui/chat/chat-event-reducer.ts](../src/ui/chat/chat-event-reducer.ts)` (prep and lifecycle render as boxed pipeline steps in the TUI transcript).
6. **PersistTurnNode** appends `response.messages` to session history (SQLite batch in headless; Ink emits save lifecycle and relies on incremental React persistence).

### Tool result cache (read-only tools)

`toby chat` also has a short-lived in-memory cache for select read-only chat tools:

- **TTL**: 5 minutes
- **Key**: `toolName + stable serialized args`
- **Scope**: SQLite-backed (`chat.sqlite`) so cache survives process restarts until TTL expiry
- **Eligibility**: read-only tool allowlist only (mutating tools and `askUser` are excluded)

Implementation paths:

- Cache implementation: `src/chat-pipeline/tool-result-cache.ts`
- Cache lookup/store hook: `src/ai/chat.ts` (`injectToolCache` wraps read-only tools; `injectToolLifecycleHooks` emits cache-hit events)
- UI marker: tool transcript rows append `[cache]` when a cached result is used

To clear cached tool results in chat, run:

- `/clear-tool-cache`

### Abort signal

`ChatWithToolsOptions` accepts an optional `abortSignal` (standard `AbortSignal`). When provided:

- The signal is forwarded to `streamText` / `generateText`, so the provider request can be cancelled mid-flight.
- Before each tool execution, the signal is checked; if already aborted the tool throws instead of running.
- The Ink TUI wires an `AbortController` per turn and aborts it when the user presses **Escape** during a loading state.

## AI prompt caching

Provider-specific prompt caching (OpenAI direct, Vercel AI Gateway, stable cache keys, status-line `cache=` / `cacheW=` telemetry, and adding new adapters) is documented in **[ai-caching.md](ai-caching.md)**.

Wiring in this pipeline:

- `src/chat-pipeline/run-turn.ts` → `applyChatPromptCaching(...)` from `src/ai/caching`
- `src/ai/chat.ts` → forwards merged `providerOptions` to `streamText` / `generateText`

